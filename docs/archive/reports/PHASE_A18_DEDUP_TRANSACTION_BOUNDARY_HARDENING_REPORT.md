# Phase A.18 — Dedup Store Transaction-Boundary Hardening

**Date:** 2026-08-13
**Scope:** Determine whether the dedup-store transaction-boundary gap A.17 identified in Automation `TriggerWorkflow` and Returns `ReceivePackage` — and deliberately did not fix — is a genuine, provable defect, and remediate it with the smallest change that fits existing architecture, without introducing a generic idempotency framework.
**Status:** Both named targets fixed, RED→GREEN, with crash-recovery and 2/3/10-way concurrency regression coverage. Repo-wide inventory rebuilt (30+ distinct dedup/replay mechanisms catalogued, not just the 6 A.17 estimated). Two genuinely new "real adapter, same gap" risks identified and documented (not fixed — outside this phase's two named targets). HTTP-layer `Idempotency-Key` cache analyzed and documented as a related-but-separate architectural concern. All 78 packages remain green (zero regressions). Nothing committed.

---

## 1. Executive Summary

A.17 found that `Automation.TriggerWorkflow` and `Returns.ReceivePackage` both used a "dedup store" — `ProcessedTriggerStore` / `ProcessedWarehouseCallbackStore` — whose `markProcessed()` write took no `tx` parameter, so it could not commit atomically with the aggregate's own `save()`. A.17 deliberately left this unfixed pending a dedicated inventory phase. This is that phase.

**The fix, for both services, is the same one-line architectural idea, not a new idempotency framework:** stop keeping "was this processed?" in a second store next to the aggregate, and instead answer that question by reading the aggregate itself. Both `AutomationWorkflow.executions` and `ReturnRequest.attempts` were _already_ persisted transactionally alongside the rest of the aggregate — `TriggerWorkflow`/`ReceivePackage` just weren't consulting them for dedup. Once the dedup check is derived from the same `findById(tx)` read used for everything else, and the "processed" marker is nothing more than the row the use case was already going to write, the two independent-commit failure modes A.17 flagged (Scenario B: aggregate commits, marker doesn't; Scenario C: marker commits, aggregate doesn't) become structurally impossible — there is only one write left, so it cannot diverge from itself. This is not a novel pattern invented for this phase: it is the **exact same shape this codebase's own `Coupons` and `Loyalty` aggregates already use** (confirmed directly by this phase's inventory, §2), making it the smallest change that both closes the gap and matches existing convention (Task 7's decision, §9).

For Automation specifically, the external `ActionDispatcherPort.dispatch()` call is a genuine, non-idempotent, non-read-only side effect (unlike Returns' `verifyReturnShipment`, which is a documented read-only check) — so the fix also mirrors the reserve/external-call/settle three-phase split already established for Fulfillment's `RequestReservation` (Phase A.15) and Payments' `CapturePaymentLifecycle` (Phase A.8/A.9): the dispatch now runs with zero DB transactions open, and a bounded `withConcurrencyRetry` (the same helper duplicated six times elsewhere in this codebase, per its own established convention) absorbs optimistic-lock races instead of leaking an unhandled `ConcurrencyError` to the caller.

A **bonus correctness fix** fell out of the redesign for free: the old `ProcessedTriggerStore.hasProcessed(triggerId)` was keyed _globally_ across every workflow in the system, not per workflow — two unrelated workflows sharing a coincidentally-identical `triggerId` would have the second one silently swallowed as "duplicate." The new aggregate-embedded check is naturally scoped to the one loaded workflow, closing this latent defect as a side effect (RED→GREEN test included, §6).

The repo-wide inventory (Task 1/2) found the "at least 6" stores A.17 estimated is actually **30+ distinct dedup/replay mechanisms** once the HTTP layer, messaging/outbox layer, and tracking pipeline are included. Two were found to be genuinely _worse_ than Automation/Returns were: **Payments' `ProcessedWebhookStore`** and **Orders'/Tracking's Kafka inbox `ProcessedEventStore`** share the identical non-tx-scoped shape but — unlike Automation/Returns — have a **real, live-wired production adapter today**. Both are documented as new P1/P2 findings (§13) but deliberately **not fixed this phase** — they are outside the two explicitly named targets, and fixing them well would need a different mechanism (Payments' aggregate has no equivalent append-only log to fold the check into; the Kafka inbox is architecturally a different problem, an at-least-once-delivery inbox, not a same-request dedup check).

**Verdict: CONDITIONALLY PRODUCTION READY** — see §17.

---

## 2. Repository-Wide Dedup Inventory

Full inventory (30 rows, every mechanism found via `markProcessed`/`hasProcessed`/`isProcessed`/`Idempotency-Key`/`idempotency`/`dedup`/`processed`/replay-store/callback-store/request-id-dedup sweeps across `services/`, `packages/`, and `apps/`) is preserved in full alongside this report. Summary by classification:

| Classification                    | Count | Meaning                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Transactionally safe**      | 8     | Dedup state lives inside the aggregate's own row/log, written in the same `save(x, tx)` call (e.g. Coupons' `hasRedemption`, Loyalty's `hasTransaction`, Payments' refund `idempotencyKey`, the outbox's mandatory-`tx` `OutboxStore.append`)                                                     |
| **B — Reject-not-resume safe**    | 6     | No dedup store needed — the aggregate's own transition table has no self-loop (Payments' `alreadyCaptured`, Notifications' `settleSuccess`/`settleFailure`, Automation's/Payments' `AuthorizePayment` inline guards, the distributed lock, the Kafka producer's protocol-level retry idempotence) |
| **C — Receiver-side idempotent**  | 4     | An external receiver (PSP, ad platform, unique-constraint-backed table) independently guarantees idempotency (Payments' PSP capture/refund keys, tracking's destination-level delivery dedup, the `EventRecordWriterPort`'s unique-constraint fail-closed write)                                  |
| **D — Transaction-boundary risk** | 10    | Dedup state and aggregate/effect state can commit independently — see §13 for the full list and disposition of each                                                                                                                                                                               |
| **E — Uncertain**                 | 2     | Insufficient evidence (a dormant `findByReservationReference` method nobody calls; an unverified tracking replay-plan dedup)                                                                                                                                                                      |

Full row-by-row detail (interface, implementation, `tx` signature, real-adapter status, same-tx verdict, rationale) for all 30 mechanisms is in the companion research transcript; the load-bearing rows are reproduced in §13.

**Coupons and Loyalty are the clean counter-examples** this phase's fix deliberately imitates: both eliminate the D-class risk entirely by keeping dedup state inside the aggregate's own persisted row rather than a separate store.

---

## 3. Classification Matrix — Automation & Returns (this phase's targets)

| Mechanism                                 | Pre-fix class | Real adapter?                                                                       | Post-fix class                                                             |
| ----------------------------------------- | ------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Automation `ProcessedTriggerStore`        | **D**         | No (in-memory stub in both wiring branches — confirmed by reading `composition.ts`) | **Eliminated** — folded into `AutomationWorkflow.executions` (class **A**) |
| Returns `ProcessedWarehouseCallbackStore` | **D**         | No (same pattern)                                                                   | **Eliminated** — folded into `ReturnRequest.attempts` (class **A**)        |

---

## 4. Automation Analysis

**Trace (pre-fix):** `findById(tx)` → `processedTriggers.hasProcessed(triggerId)` (no `tx`, global key) → `workflow.startExecution()` (in-memory mutation, **no dedup guard of its own** — `AutomationWorkflow.startExecution`'s own doc comment explicitly delegated dedup entirely to the application layer) → `dispatcher.dispatch()` (external, **inside the open transaction**) → `workflow.completeExecutionSuccess/Failure()` → `workflows.save(workflow, tx)` → `processedTriggers.markProcessed(triggerId)` (no `tx`) → transaction commits.

**Crash windows (pre-fix):**

- Between `save()`'s buffered write and the transaction's actual commit, `markProcessed()` has _already_ taken effect (it's not part of the transaction at all) — a crash here permanently marks the trigger processed while the execution itself never became durable (Scenario C).
- Any deployment where `ProcessedTriggerStore` is not a shared, durable store (confirmed: it never is, in this codebase, today) reproduces Scenario B on every process restart or horizontal replica — proven directly, not hypothetically, by this phase's RED test (§8).
- The domain aggregate itself provided **zero** secondary protection: `startExecution` pushes a new `AutomationExecution` unconditionally once `status === "active"`, with no check against `triggerId` at all pre-fix.

**Post-fix:** dedup is `workflow.executions.find(e => e.triggerId === triggerId)`, read from the same `findById(tx)` call already being made. `dispatch()` now runs with the transaction closed (reserve/dispatch/settle split, mirroring Fulfillment's A.15 precedent). `withConcurrencyRetry` (5 attempts, same bound Payments/Fulfillment/Licensing/Notifications/Shipping/Orders already use) absorbs optimistic-lock races.

---

## 5. Returns Analysis

**Trace (pre-fix):** `findById(tx)` → `processedWarehouseCallbacks.hasProcessed(source, callbackId)` (no `tx`) → `shippingPort.verifyReturnShipment()` (external, **inside the open transaction**) → `returnRequest.recordWarehouseCallback()` + `.receivePackage()` (domain mutation) → `returns.save(returnRequest, tx)` → `processedWarehouseCallbacks.markProcessed(source, callbackId)` (no `tx`) → commit.

**Crash windows (pre-fix):** structurally identical to Automation's Scenario B/C. One asymmetry found during this phase's audit that Automation does _not_ share: `ReturnRequest`'s own FSM (`receivePackage()` → `transition("package_received", ...)`, and the transition table has no self-loop) already provided a **secondary, reject-not-resume safety net** against a _duplicate committed_ receive — a second successful `receivePackage()` call after the first already committed would throw `BusinessRuleError`, not silently duplicate the transition. This is why Returns was never at risk of _local aggregate corruption_ the way Automation's `startExecution` was (which had no equivalent guard) — the pre-fix risk for Returns was narrower: a stale `ProcessedWarehouseCallbackStore` entry either (a) permanently and incorrectly suppressing a genuinely-lost operation (Scenario C) or (b) failing to prevent a redundant `verifyReturnShipment()` call (Scenario B) — the second is a **read-only, reference-only** call per its own port documentation, not a duplicate real-world mutation.

**Post-fix:** dedup is `returnRequest.attempts.some(a => a.kind === "warehouse_callback" && a.outcome === "succeeded" && a.reference === "${source}:${callbackId}")`, read from the same `findById(tx)` call. Given `verifyReturnShipment` is read-only, the fix deliberately does **not** also split it out of the open transaction — doing so would require inventing a new durable intermediate `ReturnStatus` purely to relocate a redundant read, which is exactly the kind of new-infrastructure-for-a-non-problem this phase's Absolute Constraints forbid. `withConcurrencyRetry` was still added, because concurrent racers can still hit the aggregate's optimistic lock regardless of what the external call does.

---

## 6. Crash-Recovery Analysis

Both services now have direct RED→GREEN evidence (§8) for:

- A transaction that fails to commit _after_ its callback already returned (modeling the physical window between "callback logic ran" and "COMMIT lands") leaves **zero** trace anywhere — no stray dedup marker, because there is no second store to hold one. The very next call is indistinguishable from a first-ever call, and correctly re-runs the operation.
- A genuinely-completed prior run is still correctly recognized as a duplicate by a **brand-new use-case instance constructed from scratch** (no shared in-process state), directly disproving the old design's dependency on a store surviving a process restart.

**Automation's one honestly-documented residual crash window** (Task 5's Scenario A shape, analogous to Fulfillment's own accepted risk): a crash between `dispatch()` succeeding and `settle()`'s own transaction committing leaves a `running` execution row. A standalone retry that arrives before that commit — indistinguishable at the aggregate level from "the original request is still legitimately in flight" — will re-dispatch on its first attempt (`isFirstAttempt` gate, mirroring `RequestReservation`'s identical, already-accepted tradeoff). Closing this fully needs a port-level idempotency key on `ActionDispatcherPort.dispatch()` (the port already carries `triggerId`, so a real receiver-side-idempotent adapter _could_ close it without any further local change — no real adapter exists to verify against, same "mechanism built but not wired" disposition A.16 established for Licensing's `PaymentsPort`). Documented in the code's own doc comment, not fixed — matches Task 7's "smallest approach" mandate and Fulfillment's own precedent for the identical shape of residual risk.

Returns has **no equivalent residual window** for this exact defect class, because `verifyReturnShipment` is read-only — there is no external mutation to duplicate, only a redundant read, in the narrow crash window between the aggregate write and its own commit (and even that window no longer permanently misclassifies a retry, per §5).

---

## 7. Concurrency Analysis

2/3/10-way concurrent-identical-call tests were run for both services (in-memory, deterministic `Promise.all` harness — no live PostgreSQL, see §14 for that limitation):

| Service    | Concurrency                                                 | Result pre-fix                                | Result post-fix                                                                                             |
| ---------- | ----------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Automation | 2/3/10 concurrent `TriggerWorkflow` (same triggerId)        | Unhandled `ConcurrencyError` thrown to caller | All resolve `ok`; exactly 1 durable `succeeded` execution; `withConcurrencyRetry` absorbs every loser       |
| Returns    | 2/3/10 concurrent `ReceivePackage` (same source+callbackId) | Unhandled `ConcurrencyError` thrown to caller | All resolve `ok`; exactly 1 `package_received` transition; exactly 1 succeeded `warehouse_callback` attempt |

Neither service could gracefully absorb a true concurrent race pre-fix — any losing racer's `save()` threw `ConcurrencyError` with no catch anywhere in the call stack, propagating as an unhandled rejection. This was a genuine, if narrower, additional defect beyond the two named Scenario B/C findings, closed by the same `withConcurrencyRetry` addition.

---

## 8. RED/GREEN Evidence

| File                                                                    | Pre-fix (RED)                                                                                                                                                                                                         | Post-fix (GREEN)                                                                                                                                                      |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/automation/src/trigger-workflow-transaction-boundary.test.ts` | 6/9 failed — Scenario B (duplicate dispatch across a simulated restart), Scenario C (permanent suppression after a simulated crash), 3× concurrency (unhandled `ConcurrencyError`), bonus per-workflow-scoping defect | 12/12 pass (test file rewritten post-fix to match the new `TriggerWorkflowDeps` shape — see file for the full RED commentary preserved in each test's own doc string) |
| `services/returns/src/receive-package-transaction-boundary.test.ts`     | 5/9 failed — Scenario B, Scenario C, 3× concurrency                                                                                                                                                                   | 10/10 pass                                                                                                                                                            |

Both RED runs were captured against the actual pre-fix implementation (before any source edit), confirming the failures were caused by the documented defect and not a test-authoring error — the first attempt at the crash-simulation harness (a naive `FlakyCommitUnitOfWork` that threw _without_ rolling back the fake repository's buffered write) produced a false negative on the Scenario C assertion, caught and corrected (snapshot/restore added to properly model an all-or-nothing transaction) before treating the RED result as valid evidence.

---

## 9. Transaction Boundary Decision (Task 7)

Options evaluated against Automation/Returns:

| Option                                                         | Verdict                                                      | Why                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Pass `tx` into the dedup store**                         | Rejected                                                     | Would require writing a _new_ Prisma-backed store for both (none exists today) just to make it tx-aware — solves the boundary problem but adds new infrastructure for a store that turns out to be unnecessary once B is available.                                                 |
| **B — Persist dedup state inside the aggregate transaction**   | **Chosen**                                                   | Both aggregates already had an unused append-only log (`executions`, `attempts`) persisted in the exact same `save(x, tx)` call. Zero new infrastructure, zero new tables, zero new repository methods — reuses what's already there. Directly precedented by Coupons/Loyalty (§2). |
| **C — Use an existing repository/table transaction mechanism** | Partially adopted                                            | `withConcurrencyRetry` (an _existing_, six-times-duplicated helper) was reused for the concurrency half of the fix — this is Option C for the racing-writers problem, layered on top of Option B for the dedup-boundary problem.                                                    |
| **D — Receiver-side idempotency only**                         | Rejected as the _sole_ mechanism, but already partially true | `ActionDispatcherPort.dispatch()` already carries `triggerId`; a real adapter _could_ dedupe receiver-side. Not sufficient alone because no real adapter exists to rely on today.                                                                                                   |
| **E — Outbox/inbox pattern**                                   | Rejected                                                     | This codebase's outbox pattern (§2, class A) is for _domain event publication_, a different problem (dual-write to a message broker) from _request-level dedup_ — repurposing it here would be a category error, not a fix.                                                         |
| **F — Generic idempotency abstraction**                        | Rejected                                                     | Explicitly forbidden by this phase's Absolute Constraints; also unnecessary — Option B solves both named targets without one.                                                                                                                                                       |

**Why not fix the HTTP layer or the other 8 `D`-class stores using this same pattern:** none of them has an equivalent aggregate-embedded log to fold the check into without first designing one (a real architectural change, not a local one) — Payments' `PaymentIntent` has no per-webhook-event log; the Kafka inbox pattern is architecturally an at-least-once-delivery problem, not a same-request dedup problem. Extending Option B there would not be "the same small fix" — it would be new design work for each, which is out of this phase's two explicitly named targets.

---

## 10. Fixes Implemented

### Fix 1 — Automation `TriggerWorkflow` (Task 8)

- **Removed:** `ProcessedTriggerStore` interface, `InMemoryProcessedTriggerStore` implementation, and the `processedTriggers` dependency/wiring — all now dead, deleted rather than deprecated (nothing else referenced them).
- **Added:** dedup check against `workflow.executions` (keyed by `triggerId`, scoped per-workflow); reserve/dispatch-outside-tx/settle three-phase split (mirrors Fulfillment's `RequestReservation`); `withConcurrencyRetry` (mirrors Payments/Fulfillment/Licensing/Notifications/Shipping/Orders' own copies of the identical helper).
- **Bonus fix:** dedup scope corrected from global-across-all-workflows to per-workflow (RED→GREEN test included).
- **Files:** `services/automation/src/application/automation.use-cases.ts`, `application/ports.ts`, `infrastructure/in-memory-port-adapters.ts`, `composition.ts`, `domain/automation-workflow.ts` (comment only), `domain/automation-execution.ts` (comment only).

### Fix 2 — Returns `ReceivePackage` (Task 9)

- **Removed:** `ProcessedWarehouseCallbackStore` interface, `InMemoryProcessedWarehouseCallbackStore` implementation, and the `processedWarehouseCallbacks` dependency/wiring.
- **Added:** dedup check against `returnRequest.attempts` (kind `warehouse_callback`, outcome `succeeded`, reference `${source}:${callbackId}`); `withConcurrencyRetry`. Single-transaction shape preserved (no reserve/settle split — `verifyReturnShipment` is read-only, see §5/§9).
- **Files:** `services/returns/src/application/return-lifecycle.use-cases.ts`, `application/ports.ts`, `infrastructure/in-memory-port-adapters.ts`, `composition.ts`, `domain/return-request.ts` (comment only).

Neither fix changed the public `ReceivePackageInput`/`TriggerWorkflowInput`/`Output` shapes, any HTTP route, any event contract, or the database schema. No new bounded context, no new infrastructure abstraction, no shared "idempotency framework."

---

## 11. Fixes Intentionally Rejected

| Candidate                                                                                                                                                                                                                       | Why not fixed this phase                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payments `ProcessedWebhookStore` (real adapter, same D-class gap)                                                                                                                                                               | Not one of the two named targets; `PaymentIntent` has no equivalent append-only per-event log to fold the check into — would require new domain design, not a local fix. Documented as a new P1 finding (§13).                                                                                                                                                                                                                            |
| Orders'/Tracking's Kafka inbox `ProcessedEventStore` (real adapter, `handleAtomic` support exists but unused)                                                                                                                   | Architecturally a different problem (at-least-once message-delivery inbox, not request-level dedup); the transaction-capable mechanism already exists, the gap is a wiring omission in `apps/runtime/src/composition.ts` — a real fix, but a different and larger one (wiring `unitOfWork` through every consumer) than this phase's two named targets. Documented as a new P2 finding (mitigated by receiver-side-idempotent backstops). |
| Reviews `ProcessedModerationStore`, Recommendations `ProcessedInteractionStore`, Notifications `ProcessedProviderCallbackStore`, Shipping's/Fulfillment's `ProcessedCarrierWebhookStore`, Licensing `ProcessedUsageRecordStore` | Same structural family as Automation/Returns pre-fix, but **none has a real adapter** (all in-memory-only, confirmed by composition-root reads) — not currently exploitable, same disposition A.17 established for Automation/Returns before this phase. Not one of the two named targets; fixing 6 more stores in one phase would be exactly the "fix everything automatically" this phase's Absolute Constraints forbid.                |
| HTTP-layer `Idempotency-Key` cache (`packages/http/src/server.ts`)                                                                                                                                                              | Analyzed in depth (§12) and found to be a related-but-architecturally-separate concern — documented, not redesigned, per Task 11's own instruction.                                                                                                                                                                                                                                                                                       |
| Generic transactional dedup framework                                                                                                                                                                                           | Explicitly forbidden by the Absolute Constraints; unnecessary given Option B solved both named targets without one.                                                                                                                                                                                                                                                                                                                       |

---

## 12. HTTP Idempotency Cache Findings (Task 11)

Read directly (`packages/http/src/server.ts:349-381`, `packages/redis/src/idempotency.ts`, `packages/redis/src/cache.ts`):

- **Claim taken before the handler runs** (`idempotencyKeys.claim(cacheKey, 24h)`, a Redis `SET NX EX`), **response cached after the handler returns** (`responseCache.set(...)`). Neither participates in whatever DB transaction the route handler opens internally — confirmed by design, not a bug: this is a cross-cutting HTTP concern, architecturally a different layer from a single use case's own transaction.
- **Can commit before the handler's DB transaction:** no — the claim is Redis-only and unrelated to any DB commit; it "commits" (is written) before the handler even starts.
- **Can commit after the DB transaction:** yes — `responseCache.set()` always runs strictly after `route.handle()` resolves, i.e. after the handler's own internal transaction has already committed.
- **Can become stale:** yes — the claim's 24h TTL is the only expiry; the in-file doc comment is explicit and honest about this ("successful executions never release — the claim simply expires with its TTL, holding the duplicate window open").
- **Can suppress a request whose DB transaction rolled back:** no — a thrown error inside `route.handle()` triggers `claim.release()` in the `catch` block, immediately freeing the key for retry. A **handled** domain rejection (a `Result`-shaped error response, not a throw) is cached like any other response — correct, since it's a real, reproducible answer.
- **Can allow duplicate execution after DB commit:** yes, in one specific window — a process crash between the handler's internal commit and `responseCache.set()`'s own write leaves the claim held (unreleased) but the cache empty. A retry _during_ the 24h TTL correctly gets `409 CONFLICT` (not a duplicate run); a retry _after_ the TTL expires re-executes the handler in full, including its own internal transaction, a second time.

**Disposition:** documented, not redesigned, per Task 11's explicit instruction. This is the same physical vulnerability class as Automation/Returns' pre-fix shape, but it is not the same problem — closing it would mean either extending the 24h claim window to "hold forever with manual intervention" (worse) or making a Redis claim participate in a Postgres transaction (a cross-datastore two-phase-commit problem, squarely outside "existing repository patterns can solve it"). Most routes protected by this mechanism sit in front of use cases that _also_ have their own domain-level idempotency (PSP deterministic keys, FSM reject-not-resume, or — as of this phase — Automation's/Returns' own aggregate-embedded checks), so the HTTP layer is defense-in-depth for those, not the sole guard. Recommend a dedicated future phase if this specific 24h-crash-then-retry window is ever judged worth closing.

---

## 13. Full `D`-Class Finding List (Task 10, production-readiness classification)

| Finding                                              | Real adapter?                                                                                 | P-level | Exploitability                                                                                                                                                                                                               | Mitigation                                                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automation `ProcessedTriggerStore`                   | No (pre-fix)                                                                                  | —       | **CLOSED this phase**                                                                                                                                                                                                        | Fixed (§10)                                                                                                                                                                                                 |
| Returns `ProcessedWarehouseCallbackStore`            | No (pre-fix)                                                                                  | —       | **CLOSED this phase**                                                                                                                                                                                                        | Fixed (§10)                                                                                                                                                                                                 |
| Payments `ProcessedWebhookStore`                     | **Yes, live-wired**                                                                           | **P1**  | Real, today — a crash between webhook-log write and intent-save commit could replay a Charge/Finance/notify side effect                                                                                                      | Narrowed (not eliminated) by A.9's `alreadyCaptured` guard and A.11's FSM no-self-loop guard — mostly self-healing, not exploitable via the FSM alone, but the store itself remains genuinely non-tx-scoped |
| Orders'/Tracking's Kafka inbox `ProcessedEventStore` | **Yes, live-wired**, but non-atomic branch only                                               | **P2**  | Real, but mitigated — `Order.completePayment` treats re-delivery as a benign, already-caught `BusinessRuleError` (receiver-side idempotent in effect); `EventRecordWriterPort` fails closed on a unique-constraint violation | Effectively safe by a different, independent mechanism at each site; the inbox marker itself is still non-atomic                                                                                            |
| Reviews `ProcessedModerationStore`                   | No                                                                                            | P3      | Not exploitable today                                                                                                                                                                                                        | Document only                                                                                                                                                                                               |
| Recommendations `ProcessedInteractionStore`          | No                                                                                            | P3      | Not exploitable, low severity (no financial/irreversible effect)                                                                                                                                                             | Document only                                                                                                                                                                                               |
| Notifications `ProcessedProviderCallbackStore`       | No                                                                                            | P3      | Not exploitable                                                                                                                                                                                                              | Document only                                                                                                                                                                                               |
| Shipping `ProcessedCarrierWebhookStore`              | No (file comment falsely claims a Prisma store supersedes it — confirmed no such file exists) | P3      | Not exploitable; **documentation-accuracy defect** flagged separately                                                                                                                                                        | Document only                                                                                                                                                                                               |
| Fulfillment `ProcessedCarrierWebhookStore`           | No (same false comment)                                                                       | P3      | Not exploitable                                                                                                                                                                                                              | Document only                                                                                                                                                                                               |
| Licensing `ProcessedUsageRecordStore`                | No — and **no composition-root seam exists to ever wire one**                                 | P2      | Not exploitable today, but worst-designed instance in the inventory (can't even be fixed by adding an optional constructor field the way every sibling can)                                                                  | Document only, recommend seam be added whenever Licensing usage metering goes to real infrastructure                                                                                                        |
| HTTP `Idempotency-Key` cache                         | Yes, live-wired                                                                               | P2      | Bounded by 24h TTL (§12)                                                                                                                                                                                                     | Document only, defense-in-depth for most routes                                                                                                                                                             |

---

## 14. PostgreSQL Validation (Task 12)

```
pnpm --filter @platform/db exec prisma validate --schema=prisma/schema
```

✅ **Clean** — "The schemas at prisma\schema are valid" (required `DATABASE_URL` env var to be set to parse the schema at all; a syntactically-valid placeholder connection string was used, standard for `validate`, which never opens a connection).

```
pnpm --filter @platform/db exec prisma migrate status --schema=prisma/schema
```

❌ **`P1001` — ENVIRONMENT-BLOCKED.** "Can't reach database server at `localhost:5432`." No live PostgreSQL is reachable in this environment. Identical, unresolved blocker documented unchanged across A.12–A.17 (Docker Desktop/WSL2 failure at the OS level, per A.12/A.14). Not re-diagnosed, not re-attempted beyond confirming the identical failure mode, no results fabricated. **No 2/3/10-way real-PostgreSQL concurrency test could be run** — the concurrency evidence in §7 is exclusively against the in-memory, deterministic `Promise.all` harness this codebase's own prior phases (A.8, A.15) established as the standard substitute when PostgreSQL is unreachable.

---

## 15. Regression Matrix (Task 13)

`pnpm test` (repo root, all 78 packages):

| Package                     | Result                                      | Notes                                                                                                                 |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `@platform/automation`      | **21/21** (3 files)                         | Up from 9/9 pre-phase baseline — 12 new tests in `trigger-workflow-transaction-boundary.test.ts`                      |
| `@platform/returns`         | **33/33** (5 files)                         | Up from 23/23 pre-phase baseline — 10 new tests in `receive-package-transaction-boundary.test.ts`                     |
| `@platform/payments`        | 81/81 (13 files)                            | Regression check only                                                                                                 |
| `@platform/promotions`      | 11/11 (3 files)                             | Regression check only                                                                                                 |
| `@platform/wishlist`        | 15/15 (3 files)                             | Regression check only                                                                                                 |
| `@platform/licensing`       | 36/36 (5 files)                             | Regression check only                                                                                                 |
| `@platform/orders`          | 66 passed / 5 skipped (12 files, 1 skipped) | Regression check only — 5 skipped = pre-existing DB-only integration suite, environment-blocked, unchanged since A.15 |
| `@platform/fulfillment`     | — (included in full run, all passed)        | Regression check only                                                                                                 |
| `@platform/shipping`        | 22/22 (4 files)                             | Regression check only                                                                                                 |
| `@platform/notifications`   | 33/33 (4 files)                             | Regression check only                                                                                                 |
| `@platform/finance`         | 25/25 (5 files)                             | Regression check only                                                                                                 |
| `@platform/admin`           | 123/123 (10 files)                          | Regression check only                                                                                                 |
| `@platform/runtime`         | 174/174 (30 files)                          | Regression check only                                                                                                 |
| `@platform/reviews`         | 12/12                                       | Regression check only                                                                                                 |
| `@platform/recommendations` | 10/10                                       | Regression check only                                                                                                 |
| `@platform/coupons`         | 11/11                                       | Regression check only                                                                                                 |
| `@platform/loyalty`         | 13/13                                       | Regression check only                                                                                                 |
| `@platform/security`        | 101 passed / 6 skipped (35 files)           | Regression check only                                                                                                 |
| `@platform/customer-360`    | 336 passed / 56 skipped (72 files)          | Regression check only                                                                                                 |
| `storefront`                | 64/64                                       | Regression check only                                                                                                 |
| ...all remaining packages   | all passed                                  | Every other package in the monorepo also ran and passed as part of the same root `pnpm test` invocation               |

**Turbo summary: `Tasks: 78 successful, 78 total`.** Zero regressions anywhere in the repository.

---

## 16. Quality Gates (Task 15)

| Gate                                 | Result                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (repo root)         | ✅ 78/78 tasks                                                                                                                                                                                  |
| `pnpm test` (repo root)              | ✅ 78/78 tasks (§15)                                                                                                                                                                            |
| `pnpm lint` (repo root)              | ✅ 78/78 tasks, clean                                                                                                                                                                           |
| `pnpm run arch` (dependency-cruiser) | ✅ 0 violations, 1565 modules, 6788 dependencies — unchanged from A.17 (this phase changed only application-layer control flow and deleted two now-dead interfaces; no new architectural edges) |
| `prisma validate`                    | ✅ clean (§14)                                                                                                                                                                                  |
| `prisma migrate status`              | ❌ `P1001` — **ENVIRONMENT-BLOCKED**, unchanged since A.12 (§14)                                                                                                                                |

Full repository sweep (Task 14) re-run against the same patterns Task 1 used: `markProcessed`/`hasProcessed` now match **26 files** (down from 28) — exactly the expected delta: Automation's and Returns' `ports.ts`/`in-memory-port-adapters.ts` no longer match (4 files removed, the dead interfaces/stubs are gone), offset by the 2 new test files that mention the terms in their own doc comments (+2). `Idempotency-Key`/`dedup`/`idempoten` sweeps are unchanged (28/62/139 files respectively) — neither fix touched the HTTP layer or any other service.

---

## 17. Production Readiness Verdict

**Verdict: CONDITIONALLY PRODUCTION READY**

Reasoning:

- Both explicitly named targets (Automation `TriggerWorkflow`, Returns `ReceivePackage`) had their dedup-store transaction-boundary gap **proven** with RED evidence against the real pre-fix implementation, then **closed** with a minimal, precedented fix (Coupons/Loyalty's own established pattern) and GREEN evidence — not merely "tests pass," but tests specifically engineered to fail under the exact crash/concurrency conditions the brief specified (Scenarios B, C, D, E, F), verified to fail correctly before the fix and pass correctly after.
- Both fixes also closed a real, previously-undocumented concurrency gap (unhandled `ConcurrencyError` under true concurrent racers) and, for Automation, a real latent scoping defect (global instead of per-workflow dedup) — neither was fixed speculatively; both were discovered while implementing the named fix and proven with their own RED evidence before being folded in.
- The repo-wide inventory this phase built (30+ mechanisms, not the "at least 6" A.17 estimated) found **no speculative need for a generic framework** — every mechanism examined either already uses the aggregate-embedded pattern (class A), is safe by FSM construction (class B), is safe by external-receiver design (class C), or remains a documented, unfixed D-class risk whose disposition (real adapter or not, mitigated or not) is now honestly recorded for the first time.
- It stays at _conditional_, not full, readiness because: (a) Payments' `ProcessedWebhookStore` is a **new, real, live-wired** P1 finding this phase surfaced but did not fix — narrower in scope than Automation/Returns were, but genuinely exploitable today, not merely "once a real adapter is wired"; (b) the Kafka inbox pattern (Orders' payment-captured consumer, tracking ingest) has the same non-atomic marker shape with a real adapter, mitigated by independent receiver-side idempotence but not architecturally closed; (c) real PostgreSQL concurrency/crash-recovery evidence still does not exist for any context in this repository — unchanged and environment-blocked since A.12, six phases running now; (d) the HTTP-layer `Idempotency-Key` cache's 24h-then-redeliver window (§12) is real, documented, and unfixed; (e) five more in-memory-only stores in the same structural family as Automation/Returns pre-fix remain unfixed (not currently exploitable, since none has a real adapter — same disposition A.17 established, now confirmed non-exhaustive and re-catalogued rather than newly discovered).

Nothing here is classified safe merely because no test failed — every class-A/B/C disposition above is backed by a direct code read (transition table, aggregate write, or external-receiver contract), and every class-D finding is left explicitly as "real risk, not fixed, here's why" rather than folded into a blanket "conditionally ready" without detail.

---

## 18. Files Changed

**Modified (10 files):**

- `services/automation/src/application/automation.use-cases.ts`
- `services/automation/src/application/ports.ts`
- `services/automation/src/composition.ts`
- `services/automation/src/domain/automation-workflow.ts` (doc comment only)
- `services/automation/src/domain/automation-execution.ts` (doc comment only)
- `services/automation/src/infrastructure/in-memory-port-adapters.ts`
- `services/returns/src/application/return-lifecycle.use-cases.ts`
- `services/returns/src/application/ports.ts`
- `services/returns/src/composition.ts`
- `services/returns/src/domain/return-request.ts` (doc comment only)
- `services/returns/src/infrastructure/in-memory-port-adapters.ts`

**Added (2 new test files, 22 new tests):**

- `services/automation/src/trigger-workflow-transaction-boundary.test.ts` (12 tests)
- `services/returns/src/receive-package-transaction-boundary.test.ts` (10 tests)

**Deleted (as dead code, not deprecated):**

- `ProcessedTriggerStore` interface + `InMemoryProcessedTriggerStore` implementation (Automation)
- `ProcessedWarehouseCallbackStore` interface + `InMemoryProcessedWarehouseCallbackStore` implementation (Returns)

**No schema, migration, public HTTP API, or event-contract change anywhere in this phase.** No new bounded context, no new infrastructure, no shared "idempotency framework" introduced. **No dependency changes.** No architecture violations (`pnpm run arch`: 0, unchanged module/dependency counts).

**Nothing committed.** The large pre-existing body of unrelated uncommitted work in this repository (A.1 through A.17, the Stripe PSP integration, and other pre-existing uncommitted changes visible in `git status` — including files this phase never touched, such as `docs/platform/01-WORKFLOW_AUTOMATION_ENGINE_SPEC.md` and `services/returns/src/index.ts`, which were already modified before this phase began) was left completely untouched, per the standing sprint-isolation discipline.
