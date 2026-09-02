# Tracking Compatibility Report

**Status: INVESTIGATION ONLY. No code changed. No file copied. Awaiting a decision.**

**Trigger:** P1.3 restored `apps/runtime/src/tracking/` (12 files) from the reference commit `de46df9` and it does not compile against `main`'s `@platform/tracking`.
**Baseline:** `main` @ `7925d2b` (P1.4)
**Reference:** `de46df9` — _"chore(reference): preserve full working tree as a non-canonical reference checkpoint"_
**Date:** 2026-08-04
**Continues:** `K7_FINAL_RECONCILIATION_REPORT.md`

---

## 0. Headline

`main`'s `@platform/tracking` is **not a different or newer implementation** of the reference package. It is a deliberate, documented **subset**: 48 of 87 source files, exporting 318 of 335 symbols. The 39 absent files were withheld by the K7 milestone because **no primary source names them**, not because they were superseded or broken.

Three findings decide the recommendation:

1. **All 28 missing symbols come from exactly 5 source files.** The surface is far narrower than the 39-file gap suggests.
2. **All 5 files are dependency-closed against `main`'s existing 48 files.** None of them needs the blocked `definitions/{capability,dictionary,resolution,registry-graph}` cluster or any of `execution/*`. **The blocker is evidence, not compilation.**
3. **The ingest path — the entire point of investigation C-07 — needs none of them.** `tracking-ingest.ts` compiles against `main` today, unmodified.

The decision in front of you is exactly the one `K7_FINAL_RECONCILIATION_REPORT.md` already framed and escalated: _"requiring either (a) new primary evidence … or (b) an explicit user decision to accept them at a lower evidence bar than every other milestone in this recovery has used."_

---

## 1. Package comparison

|                      | `main` | `de46df9`                                                                                                                                       |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Source files         | 48     | 87                                                                                                                                              |
| Barrel exports       | 318    | 335                                                                                                                                             |
| Absent file clusters | —      | `browser/*` (11), `execution/*` (13), `definitions/*` (9 of 11), `inspector/timeline.ts`, `runtime/{replay-runtime,telemetry}.ts`, 3 test files |

`main`'s `packages/tracking/src/index.ts:15-22` states the position in its own words:

> **K7 (partial).** This barrel intentionally exports a narrower surface than the full package source tree contains. `definitions/{capability,dictionary,event-definition,parameter,resolution,registry-graph}.ts`, all of `execution/*`, `inspector/timeline.ts`, `runtime/{replay-runtime,telemetry}.ts` and `browser/*` exist on disk but are deliberately not wired into this barrel yet — see `K7_FINAL_RECONCILIATION_REPORT.md` … Re-add their export blocks in a follow-up milestone once that evidence gap is closed, rather than assuming this list is exhaustive.

**One correction to that comment, verified this session:** it says those files _"exist on disk"_. On `main` they **do not** — all 11 named paths are absent from the working tree, not merely unexported:

```
definitions/capability.ts        ABSENT      execution/                ABSENT
definitions/dictionary.ts        ABSENT      inspector/timeline.ts     ABSENT
definitions/event-definition.ts  ABSENT      runtime/replay-runtime.ts ABSENT
definitions/parameter.ts         ABSENT      runtime/telemetry.ts      ABSENT
definitions/resolution.ts        ABSENT      browser/                  ABSENT
definitions/registry-graph.ts    ABSENT
```

The comment is accurate about _intent_ and stale about _state_ — it describes the `lumo-platform` working tree it was written against, not the reconstructed `main`.

---

## 2. Missing items, by category

All 28 symbols the restored Runtime references and `main` does not export. **Nothing here is a class or repository** — the package is port-and-function oriented; the only class is `AdapterReplayDispatcher`.

### 2.1 Missing classes (1)

| Symbol                    | Source file                 |
| ------------------------- | --------------------------- |
| `AdapterReplayDispatcher` | `runtime/replay-runtime.ts` |

### 2.2 Missing ports / interfaces (7)

| Symbol                        | Source file                       | Kind                       |
| ----------------------------- | --------------------------------- | -------------------------- |
| `ReplayTelemetryPort`         | `runtime/telemetry.ts`            | outbound port              |
| `QueueDepthPort`              | `runtime/telemetry.ts`            | outbound port              |
| `LiveInspectorPort`           | `inspector/timeline.ts`           | outbound port              |
| `EventDefinitionRegistryPort` | `definitions/event-definition.ts` | registry port              |
| `ParameterRegistryPort`       | `definitions/parameter.ts`        | registry port              |
| `ReplayRuntimeDeps`           | `runtime/replay-runtime.ts`       | composition-deps interface |
| `ScopeResolverDeps`           | `runtime/replay-runtime.ts`       | composition-deps interface |

### 2.3 Missing DTOs / value types (11)

| Symbol                | Source file                       |
| --------------------- | --------------------------------- |
| `EventDefinition`     | `definitions/event-definition.ts` |
| `ParameterDefinition` | `definitions/parameter.ts`        |
| `ReplayRunResult`     | `runtime/replay-runtime.ts`       |
| `ReplayMetrics`       | `runtime/telemetry.ts`            |
| `ReplayHealth`        | `runtime/telemetry.ts`            |
| `QueueDepthMetrics`   | `runtime/telemetry.ts`            |
| `EventTimeline`       | `inspector/timeline.ts`           |
| `TimelineEntry`       | `inspector/timeline.ts`           |

### 2.4 Missing events (2)

| Symbol                 | Source file            |
| ---------------------- | ---------------------- |
| `ReplayPlannedEvent`   | `runtime/telemetry.ts` |
| `ReplayCompletedEvent` | `runtime/telemetry.ts` |

These are **telemetry events**, not domain integration events. No `tracking.*` topic, envelope, or outbox contract is affected — verified: the missing set contains no `TRACKING_*` topic constant, and `TRACKING_CAPTURED_TOPIC` / `TRACKING_CAPTURED_VERSION` are both present on `main`.

### 2.5 Missing functions (7)

| Symbol                   | Source file                 | Role                |
| ------------------------ | --------------------------- | ------------------- |
| `runReplay`              | `runtime/replay-runtime.ts` | replay entrypoint   |
| `planDestinations`       | `runtime/replay-runtime.ts` | replay planning     |
| `resolveScope`           | `runtime/replay-runtime.ts` | replay scoping      |
| `deriveReplayMetrics`    | `runtime/telemetry.ts`      | metric derivation   |
| `deriveReplayHealth`     | `runtime/telemetry.ts`      | health derivation   |
| `countCorruption`        | `runtime/telemetry.ts`      | metric derivation   |
| `countLifecycleRefusals` | `runtime/telemetry.ts`      | metric derivation   |
| `selectRecords`          | `inspector/timeline.ts`     | record filtering    |
| `matchesFilter`          | `inspector/timeline.ts`     | record filtering    |
| `buildTimeline`          | `inspector/timeline.ts`     | timeline projection |

### 2.6 Missing composition roots (0)

**None.** `@platform/tracking` exposes no composition root — that is `apps/runtime`'s job, and `wire-tracking-runtime.ts` is it. No `wireX` function is missing from the package.

### 2.7 Missing repositories (0)

**None.** The package defines repository _ports_ (`EventRecordStorePort`, `EventRecordWriterPort`) — both present on `main` (`inspector/event-record.ts:260, 269`). The Prisma _implementation_ lives in `apps/runtime`, not the package.

### 2.8 Missing runtime adapters (0 from the package)

**None from `@platform/tracking`.** Two compiler errors are unrelated to it:

```
tracking-runtime.test.ts(10,32): Cannot find module '../modules/tracking.module'
tracking-runtime.test.ts(11,36): Cannot find module '../module'
```

These reference the **Phase-4B module framework** (`apps/runtime/src/module.ts`, `src/modules/*.module.ts` — ~80 files), deliberately not adopted in P1.2 because `de46df9`'s own commit message flags its sibling `purchaseSagaModule` as carrying defects SAGA-1…SAGA-11.

---

## 3. Classification

Per the requested scheme. **Nothing falls into B or C**, and that is the substantive result.

| Item group             | Class                                        | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All 28 symbols         | **A — Required to support restored Runtime** | Each is imported by a restored file; without it that file does not compile. See §4 for exactly which.                                                                                                                                                                                                                                                                                                                                                   |
| —                      | **B — Legacy / obsolete**                    | **Empty.** No missing symbol is superseded, deprecated, or unreferenced. Every one has a live import in the restored Runtime.                                                                                                                                                                                                                                                                                                                           |
| —                      | **C — Replaced by newer implementation**     | **Empty.** `main`'s package is a strict _subset_, not a reimplementation. Verified: every one of `main`'s 318 exports is also exported by `de46df9`; the delta is one-directional (318 ⊂ 335). No renamed or reshaped equivalent exists on `main` — the four `TS2724` "did you mean" suggestions (`DestinationRegistryPort`, `AdapterRegistryPort`, `DeliveryMetrics`) are TypeScript string-similarity guesses at unrelated symbols, not replacements. |
| The 5 **source files** | **D — Unknown**                              | This is the project's own verdict, not mine. `K7_FINAL_RECONCILIATION_REPORT.md`: `definitions/{event-definition,parameter,resolution}.ts` — _"no primary source names any of these three files, their types, or their functions, despite two full search rounds."_ `inspector/timeline.ts` — _"Unknown, no citation found in either pass."_ `runtime/{replay-runtime,telemetry}.ts` — _"Unknown, no citation found."_                                  |

**The A/D split is the whole problem.** Every missing item is simultaneously _required by the restored Runtime_ (A) and _of unknown provenance under the recovery methodology_ (D). There is no subset that is both required and evidenced.

---

## 4. Dependency graph

### 4.1 Restored Runtime file → required Tracking APIs

12 restored files. **6 compile clean against `main` today; 6 do not.**

```
apps/runtime/src/tracking/
│
├─ COMPILES CLEAN AGAINST main (6)
│  ├─ tracking-ingest.ts ................ IngestOutcome, IngestRuntimeDeps, ingestTrackingEvent,
│  │                                      isPermanentRefusal, TRACKING_CAPTURED_TOPIC,
│  │                                      TRACKING_CAPTURED_VERSION, TrackingCapturedEventPayload
│  │                                      → ALL PRESENT ON main
│  ├─ tracking-adapters.ts .............. CredentialResolverPort, HashPort, HttpTransportPort,
│  │                                      TransportEnvelope, TransportEnvelopeFactory  → ALL PRESENT
│  ├─ tracking-registry-seed.ts ......... DestinationKey, SEED_DESTINATIONS,
│  │                                      SEED_MAPPING_PROFILES, SEED_PROFILE_KEYS  → ALL PRESENT
│  ├─ tracking-registry-handle.ts ....... (no @platform/tracking imports)
│  ├─ tracking-read-routes.ts ........... DeliveryState, EventState  → ALL PRESENT
│  └─ tracking-ingest-atomic-opt-out.test.ts  → clean
│
└─ BLOCKED (6)
   ├─ tracking-telemetry.ts ─────────────► runtime/telemetry.ts
   │     countCorruption, countLifecycleRefusals,
   │     ReplayCompletedEvent, ReplayPlannedEvent, ReplayTelemetryPort
   │
   ├─ wire-tracking-runtime.ts ─────────► runtime/replay-runtime.ts  (AdapterReplayDispatcher)
   │                             └──────► runtime/telemetry.ts       (deriveReplayMetrics,
   │                                                                  ReplayRuntimeDeps*,
   │                                                                  ReplayTelemetryPort)
   │
   ├─ prisma-event-record-store.ts ─────► inspector/timeline.ts      (selectRecords)
   │     ↑ read side ONLY — see §4.3
   │
   ├─ tracking-registry.ts ─────────────► definitions/event-definition.ts (EventDefinition,
   │                             │                                         EventDefinitionRegistryPort)
   │                             └──────► definitions/parameter.ts        (ParameterDefinition,
   │                                                                       ParameterRegistryPort)
   │     + 6 × TS7006 implicit-any at lines 407-416 — CONSEQUENCES of the missing types
   │       (eventDefinitionRegistryOf / parameterRegistryOf lose their signatures), not
   │       independent defects. They disappear when the types resolve.
   │
   ├─ tracking-activation.test.ts ──────► runtime/replay-runtime.ts  (runReplay)  + 9 × TS7006
   │
   └─ tracking-runtime.test.ts ─────────► apps/runtime/src/module.ts, src/modules/tracking.module.ts
         NOT a Tracking-package dependency — Phase-4B module framework (see §2.8)
```

### 4.2 Transitive closure of the 5 candidate files — **all satisfied on `main`**

This is the decisive measurement. Every import of every candidate file resolves against files `main` already has:

| Candidate file                    | Imports                                                                                                      | On `main`?                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `runtime/telemetry.ts`            | `../replay/replay`                                                                                           | ✅ PRESENT                                                                                   |
| `runtime/replay-runtime.ts`       | `../delivery/destination`, `../ids/dedup-id`, `../inspector/event-record`, `../replay/replay`, `./telemetry` | ✅ PRESENT (`./telemetry` is itself in this set)                                             |
| `inspector/timeline.ts`           | `./event-record`                                                                                             | ✅ PRESENT                                                                                   |
| `definitions/event-definition.ts` | `../envelope/consent`, `../envelope/envelope`, `@platform/expression`                                        | ✅ PRESENT (`@platform/expression` is already a declared dependency of `@platform/tracking`) |
| `definitions/parameter.ts`        | `../delivery/destination`, `../delivery/mapping`, `@platform/expression`                                     | ✅ PRESENT                                                                                   |

**None of the five reaches `definitions/{capability,dictionary,resolution,registry-graph}.ts` or `execution/*`.**

This narrows K7's own framing. K7 correctly reported that `capability.ts`, `dictionary.ts` and `registry-graph.ts` are _transitively_ blocked because they import `event-definition.ts`/`parameter.ts`, and that all of `execution/*` is entangled the same way. But it did not state the converse, which this analysis establishes: **`event-definition.ts` and `parameter.ts` are themselves at the bottom of that chain and import nothing blocked.** The entanglement is one-directional.

So: adding these 5 files would compile. The only thing standing in the way is the evidence bar.

### 4.3 The ingest path does not touch any of it

`RecordingRuntimeDeps` (`packages/tracking/src/runtime/delivery-runtime.ts:164-173`) requires `records: EventRecordWriterPort` — the **append-only writer**, not `EventRecordStorePort`.

`PrismaEventRecordStore` implements **both** (`prisma-event-record-store.ts:130`), and `selectRecords` is called in exactly one place: inside `query()`, the `EventRecordStorePort` read method that serves replay and the read routes.

```
INGEST PATH   collector → Kafka → tracking-ingest.ts → ingestTrackingEvent
                                                      → receiveAndDeliver
                                                      → records.append()      [Writer only]
              ── requires ZERO missing symbols ──

READ/REPLAY   tracking-read-routes / runReplay → store.query() → selectRecords  [BLOCKED]
```

**Investigation C-07's stated defect — "`ingestTrackingEvent` has zero callers; nothing consumes the topic" — is closable without adding a single file to `@platform/tracking`.**

---

## 5. Recommended minimum additive change set

Three viable options. They are not equivalent in scope, risk, or what they cost in project methodology.

### Option A — Reduce the restored Runtime surface to the ingest path **(recommended)**

**Changes to `@platform/tracking`: none.**

Keep the 6 files that already compile; do not carry the 6 blocked ones in this milestone. The two gaps that leaves are both small and can be authored in `apps/runtime` (where the Prisma adapter already lives) rather than copied:

1. **A writer-only record store.** `RecordingRuntimeDeps` needs only `EventRecordWriterPort.append`. The blocked `query()`/`selectRecords` half is not on the ingest path.
2. **A registry exposing only the four ports ingest uses** — `DestinationRegistryPort`, `RuleSetRegistryPort`, `MappingRegistryPort`, `VersionResolverPort`. All four are present on `main`. The blocked `EventDefinitionRegistryPort` / `ParameterRegistryPort` are not consumed by `ingestTrackingEvent`.

|                      |                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Closes**           | C-07 in full — events are consumed, validated, enriched, routed, recorded, delivered                                                          |
| **Defers**           | replay, the inspector timeline, event/parameter definition registries, `tracking-read-routes`                                                 |
| **Methodology cost** | **Zero.** No file crosses the K7 evidence bar.                                                                                                |
| **Risk**             | Two authored components rather than restored ones — contrary to the standing "prefer restoring" rule, though both are thin and adapter-layer. |

### Option B — Add the 3 evidence-Unknown runtime/inspector files

Add `runtime/telemetry.ts`, `runtime/replay-runtime.ts`, `inspector/timeline.ts` and their export blocks.

|                      |                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unblocks**         | `tracking-telemetry.ts`, `wire-tracking-runtime.ts`, `prisma-event-record-store.ts`, `tracking-activation.test.ts` — 4 of the 6 blocked files |
| **Still blocked**    | `tracking-registry.ts` (definitions cluster), `tracking-runtime.test.ts` (module framework)                                                   |
| **Methodology cost** | Crosses the evidence bar for 3 files K7 classified _"Unknown, no citation found"_                                                             |
| **Compile risk**     | Low — dependency-closed (§4.2)                                                                                                                |

### Option C — Add all 5 (Option B + `definitions/{event-definition,parameter}.ts`)

|                      |                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unblocks**         | 5 of 6 blocked files. Only `tracking-runtime.test.ts` remains (module framework, unrelated).                                                                                                       |
| **Methodology cost** | Highest — `event-definition.ts` and `parameter.ts` are the two files K7 singled out after _two full search rounds_ found no primary source.                                                        |
| **Knock-on**         | Once present, `capability.ts`, `dictionary.ts`, `registry-graph.ts` and `execution/*` become compilable too — this is the load-bearing decision for the whole deferred cluster, not just for P1.3. |

### Recommendation

**Option A.** It closes the finding that motivated P1.3, changes nothing in `@platform/tracking`, and leaves the K7 evidence decision genuinely open instead of settling it as a side effect of a wiring milestone.

Options B and C are not blocked _technically_ — §4.2 proves they would compile. They are blocked _procedurally_, and that is a call I should not make unilaterally: it would accept files at a lower evidence bar than every other milestone in this recovery, which is precisely the escalation K7 already raised and which has not been answered.

---

## 6. What I did not do

- Did not restore or modify `packages/tracking` — no file added, removed, or edited.
- Did not copy any file from `de46df9` into the working tree during this analysis. `apps/runtime/src/tracking/` was restored _before_ the stop instruction, as part of P1.3; it is uncommitted and is what produces the errors quoted here.
- Did not redesign anything.
- Did not implement any of the three options.

**Working tree state:** `main` is clean at `7925d2b` (P1.4). Uncommitted: `apps/runtime/src/tracking/` (12 restored files), 4 workspace dependencies added to `apps/runtime/package.json` (`@platform/tracking`, `@platform/secrets`, `@platform/expression`, `@platform/rules`), and the resulting `pnpm-lock.yaml` change. Reverting is a single `git checkout`/`git clean` if Option A is chosen with a different file set.

---

## 7. Decision required

**Which option?** The specific question, stated as narrowly as I can:

> Do `runtime/telemetry.ts`, `runtime/replay-runtime.ts`, `inspector/timeline.ts`, `definitions/event-definition.ts` and `definitions/parameter.ts` get accepted into `@platform/tracking` at a lower evidence bar than the recovery methodology has used so far — or does P1.3 ship the ingest path only (Option A) and leave that decision to its own evidence pass?

I recommend **Option A** and will proceed with it on your word. I will not pick B or C without an explicit instruction, because either one settles the K7 evidence question for the entire deferred cluster.
