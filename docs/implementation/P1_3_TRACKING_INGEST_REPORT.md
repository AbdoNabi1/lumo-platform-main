# P1.3 — Tracking Ingest Pipeline

**Milestone:** P1.3 (executed after P1.4 — see that report's §2 for the sequencing correction)
**Closes:** [C-07](../investigations/C-07-tracking-pipeline-unreachable.md)
**Baseline:** `7925d2b` (P1.4)
**Date:** 2026-08-04
**Preceded by:** [`TRACKING_COMPATIBILITY_REPORT.md`](../../TRACKING_COMPATIBILITY_REPORT.md) — the compatibility analysis that scoped this milestone
**Method:** refined Option A — close the ingest path using only APIs the canonical `@platform/tracking` already exports. **The K7-deferred cluster was not restored.**

---

## 1. Objective

Investigation C-07 found the tracking platform was a producer with no consumer. `apps/collector` published `tracking.event.captured.v1`; **nothing subscribed**. `ingestTrackingEvent` — documented as the single entrance to the pipeline — had zero callers.

Every beacon returned `202 {accepted: true}`, reached Kafka, and aged out unprocessed. No validation, no enrichment, no identity stitching, no attribution, no consent-gated delivery. ~48 source files and 234 passing tests never executed in production, and the failure was invisible: _"no events delivered"_ and _"no traffic"_ are indistinguishable in every dashboard.

---

## 2. Scope constraint — what was NOT restored

The initial restore of `apps/runtime/src/tracking/` (12 files from `de46df9`) failed to compile: it referenced 28 symbols `main`'s `@platform/tracking` does not export, from 5 source files K7 deferred for lack of primary-source evidence.

Per instruction, **none of those five files was restored**:

```
packages/tracking/src/runtime/replay-runtime.ts        NOT restored
packages/tracking/src/runtime/telemetry.ts             NOT restored
packages/tracking/src/inspector/timeline.ts            NOT restored
packages/tracking/src/definitions/event-definition.ts  NOT restored
packages/tracking/src/definitions/parameter.ts         NOT restored
```

**`packages/tracking` is byte-for-byte untouched by this milestone** — verified: `git status --porcelain packages/tracking` returns nothing.

Instead, every dependency on the deferred cluster was **removed** from the restored Runtime. No abstraction was recreated, no adapter substituted for a deferred type, and no behaviour was invented to replace one.

---

## 3. Files removed (4)

Deleted from the restore rather than adapted, because each is a surface _other than_ ingest:

| File                          | Why                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tracking-telemetry.ts`       | Replay telemetry only — its entire import list is `runtime/telemetry.ts`. Nothing on the ingest path.                                                        |
| `tracking-read-routes.ts`     | Read surface. Calls `store.query()` (→ `selectRecords`). Not ingest.                                                                                         |
| `tracking-activation.test.ts` | Tests `runReplay`. Not ingest.                                                                                                                               |
| `tracking-runtime.test.ts`    | Imports `../module` and `../modules/tracking.module` — the Phase-4B module framework, deliberately not adopted (P1.2 §2). Unrelated to `@platform/tracking`. |

---

## 4. Files trimmed (3) — dependencies removed, nothing recreated

### 4.1 `prisma-event-record-store.ts` → writer-only

`RecordingRuntimeDeps.records` is typed `EventRecordWriterPort` — the **append-only** half. `selectRecords` was used in exactly one place: inside `query()`, the `EventRecordStorePort` read method serving replay and the read routes.

- Dropped: `query()`, the `implements EventRecordStorePort` clause, and the `selectRecords` / `EventRecordFilter` / `EventRecordStorePort` imports.
- Kept: `append()`, `appendHistory()` (the full `EventRecordWriterPort`), and `get()` — which needs nothing deferred.

The rows written are unchanged: the same immutable base-plus-revision structure replay reads. **Re-adding `query()` later is a local change with no schema or write-path impact.**

### 4.2 `tracking-registry.ts` → three kinds instead of five

`REGISTRY_KINDS` reduced from `[destination, mapping, rule_set, event_definition, parameter]` to `[destination, mapping, rule_set]`; the two definition registries and their `…RegistryOf` view functions removed.

`ingestTrackingEvent` resolves only destinations, mappings and rule sets — verified against `IngestRuntimeDeps`, which declares exactly `recording`, `destinations`, `ruleSets`, `ruleSetKey`, `hasher`, `clock`.

**The store's schema, parity checks and `kind` discriminator are untouched.** `TrackingRegistryEntry.kind` is free text, so rows of the two omitted kinds — if any were ever written — are simply not projected into the snapshot. Re-adding them is one line here plus the two registries, with no migration and no data change.

### 4.3 `wire-tracking-runtime.ts` → ingest composition only

- Removed: `replayFor()`, the `telemetry: ReplayTelemetryPort` input (and its entry in `REQUIRED_DEPENDENCIES`), the `deriveReplayMetrics` re-export, and the four replay imports.
- Kept intact: `assertFullyWired`, the process-lifetime `InMemoryDestinationState` (holding circuit breakers and token buckets — rebuilding it per event would silently disable both), and the snapshot-pinning discipline in `ingest()`.

---

## 5. Files added (2)

### 5.1 `apps/runtime/src/composition.ts` — `buildTrackingIngestRuntime`

Mirrors the existing `buildPaymentCapturedRuntime` and **reuses the same infrastructure** — `KafkaConsumerRuntime`, `PrismaProcessedEventStore` (Postgres inbox), `PrismaDeadLetterStore` + `DeadLetterPublisher`, retry topics, and `core.metrics`. No second consumer stack.

Loads the registry once at boot and starts `TrackingRegistryWatcher` for hot reload. Returns `null` when disabled.

### 5.2 `apps/runtime/src/tracking/tracking-ingest-wiring.test.ts` — 3 regression tests

Deliberately **structural**, not behavioural — the pipeline's behaviour is covered by `@platform/tracking`'s 234 tests; duplicating it here would test the package, not the wiring:

1. **the consumer subscribes to exactly the topic the collector publishes** — both sides read `TRACKING_CAPTURED_TOPIC`/`_VERSION` from the package, so they cannot drift into two literals that no longer match; asserts the composed value is `tracking.event.captured.v1`
2. **counters start at zero** — a counter that never moves is the "wired but dead" signal C-07 describes
3. **ingest deps resolve exactly once per event** — the provider indirection is load-bearing; re-reading the handle mid-pipeline would let a hot reload stamp a record with a version that never produced its bytes

---

## 6. Configuration added

| Key                         | Default                    | Purpose                                                                                                                                                    |
| --------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRACKING_INGEST_ENABLED`   | `off`                      | Mounts the consumer. Off by default: `loadTrackingRegistry` throws on an empty registry rather than starting, so an unseeded deployment must not mount it. |
| `TRACKING_RULE_SET_KEY`     | `tracking.routing.default` | The routing rule set. Matches `DEFAULT_RULE_SET_KEY` in `tracking-registry-seed.ts` — not an invented value.                                               |
| `TRACKING_REGISTRY_POLL_MS` | `30000`                    | Hot-reload poll interval.                                                                                                                                  |

Default-off means **this milestone changes nothing for an existing deployment** until the registry is seeded and the flag is set.

---

## 7. Verification

### 7.1 Zero code references to the deferred cluster

All 20 deferred symbols grepped across `apps/runtime/src/**/*.ts`. Every surviving hit is **inside a comment** explaining the omission:

```
prisma-event-record-store.ts:131   comment  (selectRecords — why query() is absent)
tracking-registry.ts:55            comment  (EventDefinition / ParameterDefinition)
tracking-registry.ts:195, 347      comment  (the two registry ports)
wire-tracking-runtime.ts:222       comment  (replayFor / deriveReplayMetrics)
```

**No import, no type annotation, no call site.**

### 7.2 `packages/tracking` untouched

`git status --porcelain packages/tracking` → empty.

### 7.3 Producer ↔ consumer topic agreement

`apps/collector/src/collector-endpoint.ts` publishes `topicFor(TRACKING_CAPTURED_TOPIC, TRACKING_CAPTURED_VERSION)`; `TrackingIngestHandler` declares `eventType`/`eventVersion` from the same two constants. Asserted in test 1.

### 7.4 Not verified — no live broker or database

The consumer has **never run against a real Kafka or Postgres**. `docker info` reports the daemon unreachable (the G-41 blocker, C-09). Ingest is proven to be _wired and addressed correctly_; it is not proven to _deliver_. See R1.

---

## 8. Quality gate results

| Gate         | Command           | Result                                                                        |
| ------------ | ----------------- | ----------------------------------------------------------------------------- |
| Install      | `pnpm install`    | ✅ required — 4 workspace deps added                                          |
| Typecheck    | `pnpm typecheck`  | ✅ 76 successful, 76 total                                                    |
| Lint         | `pnpm lint`       | ✅ 76 successful, 76 total                                                    |
| Test         | `pnpm test`       | ✅ 76 successful, 76 total (`@platform/runtime` 112 → **116**, 22 → 24 files) |
| Architecture | `pnpm arch`       | ✅ no dependency violations (1531 modules, 6529 dependencies)                 |
| Governance   | `pnpm governance` | ⚪ not available (P1.1 §7)                                                    |

`apps/runtime/package.json` gained 4 workspace dependencies — `@platform/tracking`, `@platform/secrets`, `@platform/expression`, `@platform/rules`. The reference manifest lists 38 more; those serve the module framework and were **not** added.

---

## 9. Risks

| #   | Risk                                                                                                                                                 | Severity | Mitigation                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The consumer has never run against a live broker or database.                                                                                        | **High** | Default-off, so it cannot break an existing deployment. `db-integration.yml` (P1.1) exercises the Prisma layer; a broker smoke test needs C-09.                                                                |
| R2  | Enabling `TRACKING_INGEST_ENABLED` against an unseeded registry fails the worker at boot (`loadTrackingRegistry` throws).                            | Medium   | Intended and explicit — _"seed the registry before starting ingest, or every event will be captured and forwarded nowhere."_ Fail-loud beats silent loss. Default-off makes it opt-in.                         |
| R3  | The ingest consumer inherits **H-05** — retry back-off sleeps in-process on a shared consumer, so a poison tracking event can stall it for up to 1h. | **High** | Pre-existing, now with a second affected consumer. H-05 remains open and is unchanged by this milestone.                                                                                                       |
| R4  | Replay is not available. Records accumulate that cannot yet be replayed.                                                                             | Medium   | Records are written in the exact base-plus-revision form replay reads. Enabling replay = restore 2 files + `replayFor` + the store's `query()`. **No data migration.**                                         |
| R5  | No tracking-specific metrics. `TrackingIngestHandler.counters()` is not exposed at `/metrics`.                                                       | Medium   | The generic `messaging_messages_*{topic,group}` series (P1.2) covers processed/failed/retried/dead-lettered for `tracking.ingest`. Per-handler counters need `HttpMetricsSink`-style wiring; not batched here. |
| R6  | Secrets resolve via `createSecretProvider()` (env + `*_FILE`). Destination credentials must be present as env vars.                                  | Low      | Same provider the rest of the platform uses. `SecretCredentialResolver` fails loudly on a missing key.                                                                                                         |

---

## 10. Deferred items

| Item                                                               | Reason                                                         | Where                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------- |
| Replay (`runReplay`, `AdapterReplayDispatcher`, `replayFor`)       | K7 evidence bar                                                | Own milestone, after an evidence pass |
| Replay telemetry (`deriveReplayMetrics`, `ReplayTelemetryPort`, …) | K7 evidence bar                                                | Same                                  |
| Inspector timeline + `store.query()` + read routes                 | K7 evidence bar (`selectRecords`)                              | Same                                  |
| Event/parameter definition registries                              | K7 evidence bar                                                | Same                                  |
| `browser/*` SDK (E2)                                               | Separately milestoned, never part of K7                        | Own milestone                         |
| Collector deployment — still not in `kustomization.yaml`           | **The consumer now exists, but the producer is not deployed.** | **H-07**                              |
| Per-handler ingest counters at `/metrics`                          | Not batched into this milestone                                | Follow-up                             |

---

## 11. State after this milestone

**C-07 closed.** `tracking.event.captured.v1` has a consumer. `ingestTrackingEvent` has a caller. The pipeline — validation, enrichment, dedup, routing, recording, consent-gated delivery — is reachable from production traffic for the first time, using only APIs the canonical package already exports.

**Honest limits:** it is default-off, has never run against live infrastructure (R1), inherits H-05 (R3), and the collector that feeds it is still not deployed (H-07). C-07's specific defect — _"`ingestTrackingEvent` has zero callers; nothing consumes the topic"_ — no longer holds.

---

## 12. Commit

Single isolated commit; working tree clean. `packages/tracking` untouched. No public API of any package changed — the only signature changes are inside `apps/runtime`, where `TrackingRuntime` lost `replayFor` and `TrackingRuntimeInput` lost `telemetry`, neither of which had any caller on this branch.
