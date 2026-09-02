# C-07 — The tracking pipeline terminates at Kafka: `ingestTrackingEvent` has zero callers

| Field                      | Value                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**               | Critical                                                                                                                                                                       |
| **Area**                   | Tracking platform / Event system / Privacy                                                                                                                                     |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                                             |
| **Blocker verdict**        | **True blocker** for the tracking product. Not a deferral — the consumer was written and then dropped from `main` during history reconstruction; it is preserved in `de46df9`. |
| **Public contract change** | **No.** A restore plus one consumer registration.                                                                                                                              |

---

## 1. Location

| File                                              | Lines   | What is there                                                           |
| ------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `packages/tracking/src/runtime/ingest-runtime.ts` | 202–249 | `ingestTrackingEvent` — the single, documented entrance to the pipeline |
| `packages/tracking/src/runtime/ingest-runtime.ts` | 96–104  | `IngestRuntimeDeps` — what a caller must supply                         |
| `packages/tracking/src/index.ts`                  | 473–480 | Barrel export of `ingestTrackingEvent` + `IngestRuntimeDeps`            |
| `packages/tracking/src/index.ts`                  | 439–442 | Comment: `receiveAndDeliver` deliberately **not** exported              |
| `apps/collector/src/collector-endpoint.ts`        | 108–116 | Publishes to `tracking.event.captured.v1`                               |
| `packages/tracking/src/collector/collector.ts`    | 59      | `TRACKING_CAPTURED_TOPIC = "tracking.event.captured"`                   |
| `apps/runtime/src/worker.ts`                      | 24      | Registers **one** consumer — the Payments→Orders one                    |

---

## 2. Current implementation

### 2a. The producer side is correct and complete

```ts
// apps/collector/src/collector-endpoint.ts:108-116
await this.deps.publisher.publish({
  topic: topicFor(TRACKING_CAPTURED_TOPIC, TRACKING_CAPTURED_VERSION),
  // Partitioned by tenant so one merchant's traffic spike cannot reorder another's, while
  // events for a tenant keep per-partition order.
  key: envelope.tenancy?.tenantId ?? envelope.eventId,
  value: serialized.data,
  headers: { "content-type": serialized.contentType },
});
```

with `messageId` deliberately set to `envelope.eventId` (line 93) so a retried browser beacon dedupes end to end against `ProcessedEventStore`.

### 2b. The consumer side does not exist

```
$ git grep -n "ingestTrackingEvent" -- '*.ts'
packages/tracking/src/index.ts:442      (comment)
packages/tracking/src/index.ts:479      (barrel export)
packages/tracking/src/runtime/ingest-runtime.ts:13   (comment)
packages/tracking/src/runtime/ingest-runtime.ts:202  (definition)
packages/tracking/src/runtime/receive-and-deliver-internal.test.ts:24,38,39  (test)
```

**No production caller.**

```
$ git grep -n "TRACKING_CAPTURED_TOPIC" -- '*.ts'
apps/collector/src/collector-endpoint.ts:27,95,110   (producer)
packages/tracking/src/collector/collector.ts:59,138  (constant + comment)
packages/tracking/src/collector/collector.test.ts:5,197
packages/tracking/src/index.ts:56                    (export)
```

**No subscriber.** `apps/runtime/src/worker.ts:24` registers exactly one consumer:

```ts
supervisor.register(buildPaymentCapturedRuntime(runtime));
```

### 2c. What is stranded

`ingestTrackingEvent` is a complete, well-built pipeline (`ingest-runtime.ts:202-249`): validate → complete/enrich → re-validate dedup → resolve rule set → route → `receiveAndDeliver`. Its own header records why it exists:

> _"M6 built `receiveAndDeliver` and left it unreachable: nothing in the platform called it…"_ (`ingest-runtime.ts:4`)

and the module is explicitly the sole gate:

> _"The only call to `receiveAndDeliver` in the platform is the one at the bottom of this function. Every entry point reaches a vendor through here, so the ordering guarantees `receiveAndDeliver` enforces — record appended before the first vendor call, above all — hold for all production traffic rather than for one transport."_ (`ingest-runtime.ts:197-200`)

So the M6 fix for "unreachable pipeline" was itself left unreachable, one level up.

---

## 3. Why it is incorrect

The tracking platform is a producer with no consumer. Specifically:

1. **Consent enforcement lives inside the stranded pipeline.** `packages/tracking/src/collector/collector.ts:38` notes the collector _"does not invent consent. Absent consent is treated as no consent"_ and defers the decision downstream — to `route()` and `receiveAndDeliver`, which never execute. So no consent decision is ever applied to an outbound vendor call, because no outbound vendor call is ever made. Today that fails safe (nothing is sent); the moment a consumer is added without care it fails open.
2. **Validation is deferred, not skipped.** The collector's `collect()` performs transport-level refusals only; `validateEnvelope` and `validateDeduplication` run inside `ingestTrackingEvent`. Malformed-but-parseable events are accepted with `202` and never validated.
3. **`environment !== "production"` refusal never runs** (`ingest-runtime.ts:~148`), so staging/dev beacons are accepted rather than refused.
4. **Kafka retention silently discards the backlog.** Unlike the outbox (C-08), where rows accumulate visibly, the tracking topic quietly ages out. There is no artefact of the loss.

---

## 4. Production impact

**The entire tracking product is inert, and the failure is invisible.**

- Every browser beacon returns `202 {accepted: true, eventId}`. The SDK, the merchant, and any dashboard see success.
- ~48 source files and 234 passing tests in `packages/tracking` — normalization, enrichment, hashing, identity graph, attribution, channel resolution, routing, delivery, resilience, replay audit, payload integrity — never execute in production.
- No event reaches any vendor destination. No identity stitching occurs. No attribution is computed.
- The `docs/architecture/09`, `16`, `17` specifications describe behaviour with no runtime path.
- Because the collector returns `202` on success and `503` only on _publish_ failure, and because publish succeeds, **there is no signal anywhere that the pipeline is not running.** "No events delivered" and "no traffic" are indistinguishable — precisely the failure mode `apps/collector/src/main.ts:4-7` warns about for a stub publisher, reproduced one hop later.

---

## 5. Smallest additive fix

**Restore, do not rewrite.** During this investigation I found that the consumer already exists — it was written, reviewed, and dropped from `main` during the history reconstruction. It is preserved in `de46df9`:

```
apps/runtime/src/tracking/tracking-ingest.ts          ← the consumer (the fix)
apps/runtime/src/tracking/wire-tracking-runtime.ts    ← its composition
apps/runtime/src/tracking/tracking-adapters.ts
apps/runtime/src/tracking/tracking-registry.ts
apps/runtime/src/tracking/tracking-registry-seed.ts
apps/runtime/src/tracking/tracking-registry-handle.ts
apps/runtime/src/tracking/tracking-telemetry.ts
apps/runtime/src/tracking/prisma-event-record-store.ts
apps/runtime/src/tracking/tracking-read-routes.ts
apps/runtime/src/tracking/tracking-activation.test.ts
apps/runtime/src/tracking/tracking-runtime.test.ts
apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts
```

Its header states the problem this finding describes, in the same terms:

> _"This is the thing M6 was missing. `wireTrackingRuntime` built a complete engine and nothing called it; this handler is what production traffic actually arrives through, and it reaches a vendor by exactly one route: `ingestTrackingEvent` → `receiveAndDeliver`."_

It also already resolves both of the decisions I had flagged as needing deliberate care:

> _"The consumer runtime dead-letters by exception, after exhausting the retry schedule. That is the right behaviour for a transient fault and the wrong one for a malformed event: a bad envelope is bad forever… So permanent refusals are dead-lettered here, directly, and the message is acked; only transient refusals throw."_

and it re-exports the topic constants from `@platform/tracking` rather than restating them, _"so the collector that publishes and the consumer that reads are literally the same constants."_

### Step 1 — restore

```bash
git checkout de46df9 -- apps/runtime/src/tracking
```

### Step 2 — register the consumer in `apps/runtime/src/worker.ts`

```ts
supervisor.register(buildPaymentCapturedRuntime(runtime));
supervisor.register(buildTrackingIngestRuntime(runtime)); // ← from wire-tracking-runtime.ts
```

### Step 3 — review before trusting the restore

1. **`prisma-event-record-store.ts` requires the tracking schema**, which is also absent from `main` — `packages/db/prisma/schema/tracking.prisma` and migration `20260719120000_tracking_platform_p5_m6` must be restored together (see C-04).
2. **Registry seeding must not silently deliver nothing.** `IngestRuntimeDeps.destinations` / `.ruleSets` must resolve to real configured registries; empty ones would make the consumer run and deliver nothing, reproducing this exact failure while appearing fixed. Read `tracking-registry-seed.ts` and confirm `ruleSetKey` comes from `RuntimeConfig` — `ingest-runtime.ts:100` requires it be _"Configuration, never hardcoded per vendor"_.
3. **Run the three restored tests** (`tracking-activation.test.ts`, `tracking-runtime.test.ts`, `tracking-ingest-atomic-opt-out.test.ts`) — they are the acceptance criteria for this fix.

**Sequencing note:** this fix depends on H-07 (the collector is not deployed at all, so no events reach Kafka in the target cluster) and on C-09 (topics must exist — `allowAutoTopicCreation: false`). Restoring the consumer without those is correct but unobservable.

---

## 6. Public contract impact

**None.**

- `ingestTrackingEvent`, `IngestRuntimeDeps`, `IngestInput`, and `IngestOutcome` are already exported from `packages/tracking/src/index.ts:473-480`. No signature changes.
- `receiveAndDeliver` stays unexported — the fix respects the FF-ARCH-09 single-ingress rule rather than working around it.
- The new consumer is a new file plus one `supervisor.register(...)` line. No existing route, event schema, or package export changes.
- The topic name and envelope shape are unchanged; the producer side is untouched.

---

## 7. Blocker or intentional deferral?

**True blocker, and _not_ a deferral — this is file loss, not a pending decision.**

`docs/KNOWN_GAPS.md` contains no gap for "tracking pipeline unwired". Every artefact points the other way:

- `ingest-runtime.ts:4` describes itself as the _fix_ for an earlier unreachability problem (_"M6 built `receiveAndDeliver` and left it unreachable: nothing in the platform called it"_).
- `packages/tracking/src/index.ts:439-442` deliberately withholds `receiveAndDeliver` from the barrel to force all traffic through `ingestTrackingEvent`.
- **The consumer that closes the loop was written** (`apps/runtime/src/tracking/tracking-ingest.ts`, plus 11 supporting files and 3 test suites) and exists in `de46df9`.

Three successive steps were taken to close this gap. Only the last one — carrying the files onto `main` — was missed. Unlike C-06, there is no dependency chain blocking it: every dependency `ingestTrackingEvent` needs is already exported from `@platform/tracking` on `main` today.

**This is the same file-loss defect as C-02, C-03, and C-04**, and it makes C-07 one of the cheapest Critical fixes available.

---

## 8. How this was verified

- `git grep -n "ingestTrackingEvent" -- '*.ts'` → 7 hits: 1 definition, 1 export, 2 comments, 3 in one test. Zero production callers.
- `git grep -n "TRACKING_CAPTURED_TOPIC" -- '*.ts'` → producer + constant + tests only; no subscriber.
- `apps/runtime/src/worker.ts` read in full (47 lines) — one `supervisor.register` call.
- `packages/tracking/src/runtime/ingest-runtime.ts` read (deps interface lines 96–104; `ingestTrackingEvent` body lines 194–249).
- `apps/collector/src/collector-endpoint.ts` read in full (178 lines).
- `packages/tracking/src/index.ts:439-442, 473-480` read.
- `git ls-files packages/tracking` → 48 files; `pnpm test` reported `@platform/tracking: 234 passed`.
- File-set diff `de46df9` vs `main` for `apps/runtime` → **80 files missing from `main`**, including the entire `apps/runtime/src/tracking/` directory (12 files).
- `git show de46df9:apps/runtime/src/tracking/tracking-ingest.ts` read — confirmed it is a `ProcessedEventStore`-backed consumer calling `ingestTrackingEvent`, with permanent-vs-transient refusal handling.
- No code was modified.
