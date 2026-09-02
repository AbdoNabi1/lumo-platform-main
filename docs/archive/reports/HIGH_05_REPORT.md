# HIGH-05 — Retry Backoff Blocking

**Source finding:** `H2-4` in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` — _"Retry back-off sleeps
in-process and head-of-line blocks the consumer."_
**Type:** Remediation. Code changed. **Public contract impact: none** (`KafkaConsumerRuntime`'s
constructor deps, and the `SupervisedConsumer` shape it implements, are both unchanged).

---

## 1. Investigate

- `packages/kafka/src/consumer-runtime.ts` (before this change), `start()`: one kafkajs `Consumer`
  subscribed to **both** `[this.topic, `${this.topic}.retry`]` in a single `consumer.subscribe()` call,
  then one `consumer.run({ eachMessage })`.
- `handleMessage` (unchanged by this fix): for a retry-topic message, `if (wait > 0) await this.sleep(wait)`
  before processing — waiting out the message's scheduled backoff in-process.
- No `partitionsConsumedConcurrently` option was passed to `consumer.run()`, so kafkajs defaults to `1`:
  `eachMessage` calls for that consumer are strictly sequential.
- `packages/kafka/src/retry-schedule.ts:14` — `DEFAULT_RETRY_SCHEDULE`'s final delay is `3_600_000` ms
  (1 hour).
- The class's own doc comment (line 49 before this change) already stated the invariant this violated:
  _"deliberately replacing `EventConsumer`'s in-process sleep loop, which must never reach a consumer
  group"_ — and `handleMessage`'s own inline comment claimed _"segregated partition — main never
  blocks"_, which was not what the code did: both topics shared one consumer, one run loop, one
  concurrency slot.

**Impact confirmed by reading, not assumed:** a single message on its Nth retry attempt sleeping up to an
hour blocks every other message on the main topic behind it in that same consumer — for the payments
consumer (`orders.payment-captured`), that stalls `payments.payment_intent.captured.v1` processing
platform-wide for up to an hour per stuck message.

## 2. Prove

Added a new test in `packages/kafka/src/consumer-runtime.test.ts`: mocks `Kafka.consumer()` to record
every call and returns fake `Consumer` objects tracking `subscribe`/`run`/`disconnect` calls. Before this
change, `start()` would have called `kafka.consumer()` exactly once with the main `consumerGroup` and
`subscribe({ topics: [topic, `${topic}.retry`] })` — both topics on the same consumer. The new test
asserts the opposite: two separate consumers, distinct group IDs, each subscribed to exactly one topic.

## 3. Implement

`packages/kafka/src/consumer-runtime.ts`:

- `start()` now creates a **second** kafkajs `Consumer`, with `groupId: `${this.deps.consumerGroup}.retry``,
  subscribed only to `[`${this.topic}.retry`]`, with its own `run({ eachMessage })` call — the retry
  topic's in-process sleep now runs on a completely independent consumer with its own concurrency slot,
  so it can never block the main topic's consumer.
- The main consumer's `subscribe()` now takes only `[this.topic]` — it never sees a retry message and
  never calls `sleep`.
- `stop()` disconnects both consumers.
- `handleMessage` is untouched — the retry-vs-main branch (via the retry headers) still works identically
  regardless of which physical consumer delivered the message; `processedEvents`/dead-letter scoping
  still key on `this.deps.consumerGroup` (the original name), unaffected by the retry consumer's distinct
  kafkajs `groupId`.

A distinct `groupId` (rather than a second member of the _same_ Kafka consumer group subscribed to a
different topic) was chosen over the audit's parenthetical alternative, to avoid the group-coordinator
ambiguity of heterogeneous per-member topic subscriptions within one group — this is the design the
class's own doc comment already described ("segregated partition — main never blocks"), now actually
implemented that way, matching the audit's preferred fix.

## 4. Run

| Gate             | Result                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| `pnpm typecheck` | ✅ 76/76                                                                     |
| `pnpm lint`      | ✅ 76/76                                                                     |
| `pnpm test`      | ✅ 76/76 tasks; `@platform/kafka` `consumer-runtime.test.ts` 4 tests (was 3) |
| `pnpm arch`      | ✅ no dependency violations (1,531 modules, 6,672 deps)                      |

## 5. Scope discipline

No architecture change, no new bounded context, no public API change — `KafkaConsumerRuntimeDeps`,
`SupervisedConsumer`, and every existing call site (`buildPaymentCapturedRuntime`, `buildTrackingIngestRuntime`,
`buildProcessedConsumer` and every consumer built through it) are unchanged; the fix is entirely internal
to `start()`/`stop()`. Topic provisioning is unaffected — only the Kafka consumer _group id_ used for the
retry sub-consumer changed, not any topic name (topic provisioning is `HIGH_06`'s concern).
