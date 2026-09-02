# H-05 — Retry back-off sleeps in-process on a shared consumer, head-of-line blocking the main topic

| Field                      | Value                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | High                                                                                                                               |
| **Area**                   | Event system / Reliability                                                                                                         |
| **Baseline**               | `main` @ `756bce3`                                                                                                                 |
| **Blocker verdict**        | **True blocker.** Not a deferral — the class documents this exact defect as the thing it was built to avoid, then reintroduces it. |
| **Public contract change** | **No.**                                                                                                                            |

---

## 1. Location

| File                                     | Lines   | What is there                                                                          |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `packages/kafka/src/consumer-runtime.ts` | 93–101  | One consumer subscribes to **both** topics; `consumer.run` takes no concurrency option |
| `packages/kafka/src/consumer-runtime.ts` | 120–124 | `await this.sleep(wait)` inside `eachMessage`                                          |
| `packages/kafka/src/consumer-runtime.ts` | 47–56   | The docblock that names this defect as the thing being avoided                         |
| `packages/kafka/src/retry-schedule.ts`   | 13–15   | `DEFAULT_RETRY_SCHEDULE = [5s, 30s, 2m, 10m, 1h]`                                      |
| `packages/kafka/src/consumer-runtime.ts` | 236–251 | Republish to `<topic>.retry` with attempt + due headers                                |
| `apps/runtime/src/composition.ts`        | 203–217 | The one registered consumer; no `retrySchedule` override                               |

---

## 2. Current implementation

### 2a. One consumer, two topics, default concurrency

```ts
// packages/kafka/src/consumer-runtime.ts:93-101
const consumer = this.deps.kafka.consumer({
  groupId: this.deps.consumerGroup,
  allowAutoTopicCreation: false,
});
await consumer.connect();
await consumer.subscribe({ topics: [this.topic, `${this.topic}.retry`], fromBeginning: false });
await consumer.run({
  eachMessage: (payload) => this.handleMessage(payload),
});
```

`consumer.run` is called **without `partitionsConsumedConcurrently`**. kafkajs defaults that option to `1`, meaning `eachMessage` invocations are serialized across every assigned partition of every subscribed topic.

### 2b. The handler sleeps

```ts
// packages/kafka/src/consumer-runtime.ts:120-124
// Retry-topic message: wait out its remaining delay (segregated partition — main never blocks).
if (retry !== null) {
  const wait = retry.dueAtMs - this.deps.clock.now().getTime();
  if (wait > 0) await this.sleep(wait);
}
```

with

```ts
// packages/kafka/src/retry-schedule.ts:12-15
/** Default production schedule: 5s → 30s → 2m → 10m → 1h, then DLQ. */
export const DEFAULT_RETRY_SCHEDULE: RetrySchedule = {
  delaysMs: [5_000, 30_000, 120_000, 600_000, 3_600_000],
};
```

### 2c. The class documents this exact defect — twice

```ts
// packages/kafka/src/consumer-runtime.ts:47-56
/**
 * Production consumer runtime (Sprint 2.5, D-046). Composes the EXISTING ports — serializer,
 * `ProcessedEventStore`, DLQ — with broker-side redelivery, deliberately replacing
 * `EventConsumer`'s in-process sleep loop, which must never reach a consumer group (ADR-0005
 * note, G-9: sleeping in `eachMessage` head-of-line blocks the partition).
 *
 * Flow per message: … attempt < max ⇒ republish ORIGINAL bytes to `<topic>.retry` with attempt+due
 * headers and ack; attempt = max ⇒ DLQ publish + row, ack. The main topic never blocks; a poison
 * message can loop at most `maxAttempts` times, then rests in the DLQ.
 */
```

_"sleeping in `eachMessage` head-of-line blocks the partition"_ — and line 123 sleeps in `eachMessage`.

---

## 3. Why it is incorrect

The architecture is right; one implementation detail defeats it.

The intended design is **broker-side** redelivery: republish to a retry topic with a due timestamp and let a _separate_ consumer, on a _separate_ group, pick it up when due. That correctly isolates slow retries from live traffic.

What is implemented is **in-process** waiting on the _same_ consumer instance that serves the main topic:

1. `subscribe({ topics: [this.topic, \`${this.topic}.retry\`] })` puts both topics on one consumer.
2. `consumer.run({ eachMessage })` with default `partitionsConsumedConcurrently: 1` serializes all invocations.
3. Therefore a `sleep(3_600_000)` on a retry-topic message blocks the main topic for one hour.

The comment _"(segregated partition — main never blocks)"_ at line 120 assumes partition-level isolation that this configuration does not provide. Partitions are only consumed concurrently when `partitionsConsumedConcurrently > 1`, and even then kafkajs makes no guarantee of fairness across topics on one consumer.

There is a second, independent consequence: kafkajs's `sessionTimeout` (default 30 s) and its internal `maxPollInterval` are violated by a blocked `eachMessage`. Any sleep beyond that window causes the broker to consider the member dead and trigger a **group rebalance**, which cancels the in-flight handler and reassigns partitions. With a 2 m/10 m/1 h schedule, attempts 3–5 guarantee this.

---

## 4. Production impact

Applied to the one consumer that is actually registered — `orders.payment-captured` (`apps/runtime/src/composition.ts:184`), the platform's only working cross-context flow:

- **Attempt 3 (2 min):** the consumer stops processing payment-captured events for two minutes. Orders are not marked paid.
- **Attempt 5 (1 hour):** a **one-hour** total stall of order payment processing, triggered by a single failing message.
- **Rebalance loop:** because the sleep exceeds `maxPollInterval`, the broker evicts the member. On rejoin, the retry message is redelivered, the handler sleeps again, and it is evicted again. This is a livelock: the consumer group never stabilizes and the main topic is never served. Recovery requires operator intervention.
- **`replicas: 2`** (`infrastructure/k8s/21-deployment-worker.yaml:12`) does not help. Both pods join the same group; the rebalances affect both, and the retry partition is reassigned to whichever pod is alive — which then stalls in turn.
- **Invisible.** Per **H-04**, `messaging_messages_*_total` is never emitted, so neither the retry rate nor the stall would appear on any dashboard. The only symptom is orders silently not transitioning to paid.

Trigger likelihood is high, not theoretical: with C-01, `MarkOrderPaid`'s repository is Prisma-backed but the order it looks up may not exist (Orders is one of the 35 in-memory contexts on the write path), producing exactly the kind of repeatable failure that reaches attempt 5.

---

## 5. Smallest additive fix

Two changes. Option A is the minimum; Option B is the correct end state.

### Option A — separate consumer, bounded sleep (smallest correct fix, ~15 lines)

Run the retry topic on its **own** consumer instance with its **own** group id, so a sleep there cannot block the main topic, and cap the sleep well below `sessionTimeout`:

```ts
async start(): Promise<void> {
  if (this.consumer !== null) return;

  // Main topic — never sleeps.
  const main = this.deps.kafka.consumer({ groupId: this.deps.consumerGroup, allowAutoTopicCreation: false });
  await main.connect();
  await main.subscribe({ topics: [this.topic], fromBeginning: false });
  await main.run({ eachMessage: (p) => this.handleMessage(p) });

  // Retry topic — separate group so its waiting is isolated from live traffic.
  const retry = this.deps.kafka.consumer({
    groupId: `${this.deps.consumerGroup}.retry`,
    allowAutoTopicCreation: false,
  });
  await retry.connect();
  await retry.subscribe({ topics: [`${this.topic}.retry`], fromBeginning: false });
  await retry.run({ eachMessage: (p) => this.handleMessage(p) });

  this.consumer = main;
  this.retryConsumer = retry;
}
```

and replace the unbounded wait with a bounded one that re-defers rather than sleeping long:

```ts
if (retry !== null) {
  const wait = retry.dueAtMs - this.deps.clock.now().getTime();
  if (wait > MAX_IN_HANDLER_WAIT_MS) {
    // e.g. 10_000, well under sessionTimeout
    await this.republishNotYetDue(payload, retry); // re-publish unchanged, ack, do not sleep
    return;
  }
  if (wait > 0) await this.sleep(wait);
}
```

`stop()` must disconnect both consumers.

### Option B — the standard tiered-topic pattern (correct end state)

One topic per delay tier (`<topic>.retry.5s`, `.30s`, `.2m`, `.10m`, `.1h`), each consumed by its own group. The producer routes by attempt number; no consumer ever sleeps beyond a tier's granularity. This is more work but eliminates the sleep entirely and is the shape most Kafka retry implementations converge on.

### Verify with the tests that already exist

`packages/kafka/src/consumer-runtime.test.ts` injects `deps.sleep` specifically to keep tests deterministic (`consumer-runtime.ts:36-37`). Add a case asserting that a not-yet-due retry message is **re-published and acked** rather than slept on — that is the regression guard this defect needs.

---

## 6. Public contract impact

**None.**

- `KafkaConsumerRuntimeDeps` is unchanged. `sleep` and `retrySchedule` remain injectable and optional.
- `start()`, `stop()`, `handleMessage()`, `topic`, `consumerGroup`, `isRunning` keep their signatures. `handleMessage` remains directly callable by tests.
- Option A adds a **second consumer group** (`<group>.retry`) at the broker. This is an operational change, not a code contract change, but it must be reflected in `infrastructure/docker/redpanda/bootstrap-topics.sh` and any k8s topic-bootstrap job.
- Option B would add new topics — a broker-side change requiring the same bootstrap update. Neither alters the event envelope, headers, or DLQ format.

---

## 7. Blocker or intentional deferral?

**True blocker, and explicitly the opposite of a deferral.**

`docs/KNOWN_GAPS.md` records **G-9** as the gap this class was written to _close_, and the class's docblock says so directly: it _"deliberately replac[es] `EventConsumer`'s in-process sleep loop, which must never reach a consumer group (ADR-0005 note, G-9: sleeping in `eachMessage` head-of-line blocks the partition)."_

So the defect is precisely-diagnosed, correctly-designed-against, and then reintroduced by the implementation. Nobody deferred it; it was believed fixed.

This is a class of bug that is **only** findable by reading `consumer.run`'s options against kafkajs's defaults, or by watching a real broker stall. Per **C-09** no broker has ever run, and per **H-09** `kafka-runtime.integration.test.ts` has never executed in CI — which is exactly why a defect this well-understood survived to HEAD.

---

## 8. How this was verified

- `packages/kafka/src/consumer-runtime.ts` read in full (271 lines).
- `packages/kafka/src/retry-schedule.ts` read in full (28 lines).
- `consumer.run(...)` at lines 99–101 confirmed to pass only `eachMessage` — no `partitionsConsumedConcurrently`, whose kafkajs default is `1`.
- `subscribe` at line 98 confirmed to take both `this.topic` and `${this.topic}.retry` on one consumer.
- `apps/runtime/src/composition.ts:203-217` read — no `retrySchedule` override, so `DEFAULT_RETRY_SCHEDULE` (max 1 h) applies.
- `apps/runtime/src/worker.ts` read — this is the only registered consumer.
- `packages/kafka/src/kafka-runtime.integration.test.ts` present but broker-gated; `pnpm test` reported `@platform/kafka: 8 passed | 1 skipped`.
- No code was modified.
