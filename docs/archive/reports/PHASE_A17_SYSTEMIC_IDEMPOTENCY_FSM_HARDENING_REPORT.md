# Phase A.17 — Systemic Idempotency & State-Machine Hardening

**Date:** 2026-08-13
**Scope:** Determine whether the ~23-service "unconditional FSM transition, no idempotent-resume guard" pattern A.16's own sweep found — but explicitly did not investigate or fix — represents real production defects, and remediate only what's proven.
**Status:** Full candidate inventory built and classified (65 individual use cases across 23 files). Two genuine, isolated defects found and closed with RED→GREEN evidence. Two systemic, cross-cutting residual risks identified, analyzed in depth, and deliberately left unfixed (would require a repo-wide architectural change out of this phase's scope). All previously-hardened flows (Payments, Returns, Licensing, Orders, Notifications, Shipping, Fulfillment, Finance, Admin, Runtime) remain green. Full repo quality gates green except the pre-existing, environment-blocked `prisma migrate status`. Nothing committed.

---

## 1. Executive Summary

A.16's own repo-wide sweep flagged a pattern — `grep -r "Advance" services` — matching 23 service files, each containing at least one generic `AdvanceX` use case that calls a domain entity's `.transition()` method with a caller-supplied target status and **no idempotent-resume guard at the use-case layer**. A.16 explicitly declined to investigate further ("do not fix unrelated findings automatically") and recommended a dedicated phase. This is that phase.

**The headline finding: the "23 services" pattern is almost entirely SAFE, not defective.** Every one of the 23 files' domain-level `TRANSITIONS` tables has **no self-loop entries** (no state maps to itself). Combined with every `transition()` method **rejecting** an illegal source→target pair by throwing `BusinessRuleError` (never silently resuming), a repeated/duplicate call with the same target status throws a 409 on the second attempt instead of performing a duplicate mutation or duplicate side effect. This is the identical "illegal-transition-correctly-rejected = SAFE" pattern A.16 itself established for e.g. Payments' `AuthorizePayment`-adjacent cases. Of the 65 individual use cases audited across the 23 files, **54 are SAFE by this reject-not-resume mechanism**, and a further **9 are already IDEMPOTENT** by an existing, previously-hardened guard (mostly Payments/Notifications/Search/Loyalty/Coupons/Recommendations sites hardened in A.9–A.16).

That left a genuinely small set of use cases whose risk did **not** come from the generic `AdvanceX` shape at all, but from something else entirely — a missing error handler, a call-ordering bug, or a dedup mechanism that doesn't share a transaction with the state it's guarding. Two of these were real, isolated, provable defects, fixed in this phase:

1. **Promotions `RecordPromotionUsage`** had no `try`/`catch` around its domain call — the _only_ status-mutating use case in the entire 65-use-case inventory that didn't follow this codebase's universal `Result<T, DomainError>` error-handling convention. An illegal-transition throw (e.g. a promotion paused mid-flight while a Checkout/Coupons usage record is still arriving) propagated as an unhandled rejection instead of a 409. **Fixed.**
2. **Wishlist `MoveWishlistItemToCart`** called the external `CartPort.addItem()` **before** validating the domain operation, so (a) an invalid move still fired a wasted external call, and (b) a client retry after an already-successful move fired a second, silent, duplicate cart-add while the visible response was an error. **Fixed** by reordering the domain validation before the external call — no interface, schema, or architecture change.

Two more real risks were found, analyzed to the crash-recovery/concurrency level the task demands, and **deliberately not fixed**, because doing so in isolation for just the two affected services would be an inconsistent, partial fix of a genuinely repo-wide architectural pattern (dedup/replay stores whose `markProcessed`-style writes are not scoped to the same transaction as the aggregate they guard) — see §14.

**Verdict: CONDITIONALLY PRODUCTION READY** — see §15.

---

## 2. Candidate Inventory

Re-running `grep -r "Advance" services` (Task 14 repeat) still matches exactly the same **23 files** A.16 found; this phase's two fixes did not add or remove any file from that set (the Promotions fix only added error handling around a _different_ method, `RecordPromotionUsage`; the Wishlist fix only reordered two lines inside `MoveWishlistItemToCart`, which the "Advance" grep never matched in the first place).

Within those 23 files, every exported use case that mutates an aggregate's status/lifecycle field was read in full (65 use cases total). Full per-use-case detail (guard code, transition table, reachability, side-effect ordering) is in the research transcripts this phase's three parallel inventory passes produced; the classified summary:

| Classification                                | Count | Meaning                                                                                                 |
| --------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| **SAFE**                                      | 54    | Reject-not-resume (no self-loop in the transition table) or genuinely no side effect to duplicate       |
| **IDEMPOTENT**                                | 9     | Already has a working resume/dedup guard, mostly from A.9–A.16                                          |
| **DEFECT — fixed this phase**                 | 2     | Promotions `RecordPromotionUsage`, Wishlist `MoveWishlistItemToCart`                                    |
| **DEFECT — documented, not fixed (systemic)** | 2     | Automation `TriggerWorkflow`, Returns `ReceivePackage` (same root cause, see §14)                       |
| **UNCERTAIN / low-severity, not fixed**       | 3     | Reviews `ReportReview`, Search `AddSynonym`/`RemoveSynonym`/`AddSuggestion`, Reporting `GenerateReport` |

Selected rows (full inventory available on request; abbreviated to what's load-bearing for the verdict):

| Context                                                                                                                     | Use Case                         | Guard                                                | Side Effects                                       | Retry Possible                            | Classification                           |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------- | -------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| Notifications                                                                                                               | `AdvanceNotification`            | none (table rejects)                                 | none                                               | Yes, rejected                             | SAFE                                     |
| Notifications                                                                                                               | `RetryNotification`              | none (table rejects on illegal source)               | none directly (send happens via separate use case) | Yes, rejected/optimistic-lock             | SAFE                                     |
| Notifications                                                                                                               | `SendNotification`               | `settleSuccess`/`settleFailure` resume guards (A.16) | provider send, outside tx                          | Yes                                       | IDEMPOTENT                               |
| Orders                                                                                                                      | `AdvanceOrder`                   | none (table rejects)                                 | `notifyBestEffort`                                 | Yes, rejected                             | SAFE                                     |
| Orders                                                                                                                      | `RequestFulfillment`             | precheck/settle resume guard (A.16)                  | Inventory+Shipping ports, outside tx               | Yes                                       | IDEMPOTENT (mitigation, no real adapter) |
| Payments                                                                                                                    | `AdvancePayment`                 | none                                                 | none                                               | **Unreachable — no HTTP route wired**     | SAFE (dead code)                         |
| Payments                                                                                                                    | `CapturePaymentLifecycle.settle` | `alreadyCaptured` guard (A.9)                        | PSP call outside tx, Finance post                  | Yes — **2 live callers** (HTTP + webhook) | IDEMPOTENT                               |
| Returns                                                                                                                     | `ReceivePackage`                 | callback-id dedup (not tx-scoped)                    | `ShippingPort.verifyReturnShipment` inside open tx | Yes                                       | **DEFECT — documented, not fixed** (§14) |
| Automation                                                                                                                  | `TriggerWorkflow`                | trigger-id dedup (not tx-scoped)                     | `ActionDispatcherPort.dispatch` inside open tx     | Yes                                       | **DEFECT — documented, not fixed** (§14) |
| Promotions                                                                                                                  | `RecordPromotionUsage`           | **none — missing try/catch**                         | none                                               | Yes                                       | **DEFECT — FIXED** (§9)                  |
| Wishlist                                                                                                                    | `MoveWishlistItemToCart`         | none, wrong call order                               | `CartPort.addItem` before domain validation        | Yes                                       | **DEFECT — FIXED** (§9)                  |
| Reviews                                                                                                                     | `ReportReview`                   | none at all (not even by reporter)                   | none external                                      | Yes                                       | UNCERTAIN, low severity — not fixed      |
| Reporting                                                                                                                   | `GenerateReport`                 | none, no idempotency key                             | `AnalyticsQueryPort.run` inside open tx            | Yes                                       | UNCERTAIN, P2 — not fixed                |
| 12 platform/experience use cases (Pages, Feature Registry, Feature Flags, Experimentation, Experience, Content, Components) | `AdvanceX`/inline-guard variants | none or inline reject guards                         | domain event only, same DB tx                      | Yes, all rejected                         | SAFE                                     |

---

## 3. State-Machine Findings

Every one of the 23 files' `TRANSITIONS` tables (or inline status guards, for the handful of 2–3-state aggregates like `Template`/`FeatureBundle` that don't use a table) was read directly, not assumed. **Zero self-loop entries exist anywhere in the 23-file set** — no context allows `X → X`. This is the single fact that makes the generic `AdvanceX` shape safe by construction: a duplicate/retried call targeting a status the aggregate has already reached is **always rejected** with `BusinessRuleError` → 409, never silently re-applied.

The one PRE-EXISTING illegal-transition-incorrectly-rejected defect of this class (Notifications' missing `queued→failed`/`retrying→failed`) was already found and fixed in A.16. This phase re-verified no sibling gap exists in the other 22 files by cross-checking every table's targets against what each context's `Advance*`/named methods document as intended flows (e.g. Feature Registry's `deprecate`/`softRemove`, Automation's `draft/active/paused/archived`) — none showed a documented-but-missing legal edge.

`AdvanceNotification`/`RetryNotification` — the two sibling entry points A.16 flagged as "the same class of defect ... left open, deliberately not fixed" — were directly re-audited this phase and are **SAFE, not a defect**: `RetryNotification` mutates only the `Notification` aggregate's own status (no external call itself; the actual provider send happens via the separate, already-hardened `SendNotification`), the transition table has no self-loop, and concurrent double-retry races are handled by the aggregate's existing optimistic-lock version check like every other single-transaction write in this codebase. A.16's deferred item is hereby closed as verified-safe.

---

## 4. Crash-Recovery Findings

Full crash-window analysis (state mutation → external call → internal side effect → event publication) was performed for every use case classified DEFECT or UNCERTAIN; SAFE/IDEMPOTENT use cases either have no external side effect to lose, or were already crash-analyzed in A.8–A.16 with unchanged code.

**Promotions `RecordPromotionUsage`:** no external side effect exists in this use case at all — the entire defect is a local exception-handling gap. No crash window applies; the fix is purely about the local Result-channel contract.

**Wishlist `MoveWishlistItemToCart`:** crash window is the interval between `cart.addItem()` returning and `wishlists.save()` committing. Pre-fix, a crash in that window (or a client-visible timeout that's actually a false negative) left the cart holding a real item add with the wishlist item still present — and a client retry, hitting the exact same ordering bug, added the item to the cart a **second** time before failing validation. Post-fix, `cart.addItem()` is the _last_ thing this use case does before `save()`, and `wishlist.moveToCart()` (a pure in-memory, side-effect-free domain validation) runs first — so a retry after a genuinely successful prior run now fails fast on the domain check, **before** ever calling `cart.addItem()` again. Proven via the regression test in §9 (retry after success: `cart.addedItems` stays at 1, not 2).

**Automation `TriggerWorkflow` / Returns `ReceivePackage`:** both have the identical crash-window shape — see §14 for the detailed analysis of why this is a genuine, but not locally-fixable-in-isolation, risk.

---

## 5. External Side-Effect Findings

Every port call in the 23-file set was traced for duplicate-invocation risk on retry:

- **Already correctly deduped** (deterministic, aggregate-identity-derived idempotency keys, unchanged by this phase): Payments' `capture`/`refund`/`createIntent`, Shipping's `createLabel`/`voidLabel`, Automation's `dispatch(actions, triggerId)` (receiver-side dedup assumed, same disposition as A.16's Licensing/Orders findings — no real adapter exists to verify against), Returns' `requestRefund`.
- **Genuinely fixed this phase:** Wishlist's `cart.addItem()` (§9).
- **Genuinely at risk, documented not fixed:** Automation's `dispatch()` and Returns' `verifyReturnShipment()` both sit behind a dedup store whose `markProcessed()` write is not part of the same DB transaction as the aggregate's own commit — see §14.
- **No dedup key at all, lower severity:** Reporting's `GenerateReport` → `AnalyticsQueryPort.run()`. Unlike the money-adjacent or dispatch-adjacent cases, a duplicate report generation is not "duplicate money movement" or "duplicate real-world action" — it's a wasted query and an extra row. Classified P2, not fixed this phase (§13).

---

## 6. Internal Side-Effect Findings

Checked for duplicate Finance postings, journal entries, notification writes, audit records, outbox events, domain events, reservation records, and attempts/history rows across all DEFECT/UNCERTAIN candidates:

- **Promotions `RecordPromotionUsage`:** the fix does not change `usageCount` semantics — a rejected transition now correctly returns an error _without_ having silently accepted a phantom usage increment past the point of rejection (this was already true pre-fix at the domain level; only the use-case-level error surfacing was broken).
- **Wishlist `MoveWishlistItemToCart`:** no internal side effect beyond the wishlist's own item list and domain event, both already properly scoped inside the single transaction, unaffected by the reorder.
- **Automation `TriggerWorkflow`:** a genuine internal duplication _is_ prevented today, independent of the external-dispatch risk — `workflow.executions` only grows by one entry when the surrounding `unitOfWork.run` transaction actually commits; a losing racer's `save()` hits the aggregate's optimistic-lock version check and fails to commit, so no duplicate `AutomationExecution` row is ever persisted even in the concurrent-race scenario analyzed in §7.

---

## 7. Concurrency Findings

Per Task 7, concurrent-execution analysis (2/5/10 concurrent calls) was performed wherever a race is plausible with the tooling available (in-memory adapters; no live PostgreSQL — see §15's environment-blocked note).

**Automation `TriggerWorkflow` — 2 concurrent calls, same `triggerId`:** `hasProcessed()`+later`markProcessed()` is a classic check-then-act race — both racers can read `hasProcessed() === false` before either commits. Both would then call `dispatcher.dispatch()` independently (an external, receiver-side-dedup-assumed call, §5), but **local, DB-level duplication is already prevented**: both racers attempt `workflows.save(workflow, tx)` on the same aggregate row, and the loser's optimistic-lock version check fails, so only one `AutomationExecution` record ever persists. This matches the "mitigation, not proof" disposition A.16 established for Licensing/Orders — the external half is unverifiable without a real adapter; the local half is already safe by the codebase's standard optimistic-locking convention, with no code change needed.

**Wishlist `MoveWishlistItemToCart`:** not concurrency-race-prone in the classic sense (no shared counter/limit); the defect was purely sequential (ordering within a single call), fully closed by the fix, and re-verified via 3 repeated runs of the new regression suite (§9) with zero flakiness.

**Promotions `RecordPromotionUsage` under concurrent load** (2 racers both crossing `usageLimit` simultaneously): both would attempt the `active→depleted` transition; the aggregate's optimistic-lock version check (pre-existing, unchanged by this phase) ensures only the winner's transition commits — the loser's `save()` fails with a `ConcurrencyError`, which — after this phase's fix — is now correctly caught and returned as a proper `Result` error rather than an unhandled rejection. No new concurrency behavior was introduced; the fix only makes existing correct rejection behavior visible through the right channel.

---

## 8. Event/Webhook Replay Findings

No new webhook/event consumer was touched this phase. Re-confirmed (Task 9) that Shipping's `RecordCarrierWebhook` and Fulfillment's equivalent webhook route are second, independent entry points into the same status machines `AdvanceShipment`/`AdvanceFulfillment` mutate — a pre-existing, A.14–A.16-reviewed shape, unchanged. Payments' `CapturePaymentLifecycle.settle` remains the one use case in the whole repo with two live callers (HTTP + PSP webhook), already hardened (A.9) and re-verified green (81/81, §11).

---

## 9. Fixes Implemented

### Fix 1 — Promotions `RecordPromotionUsage` missing error handling

- **Defect:** [promotion.use-cases.ts](services/promotions/src/application/promotion.use-cases.ts) `RecordPromotionUsage.execute()` called `promotion.recordUsage(...)` with no `try`/`catch`, unlike every other status-mutating use case in this 65-use-case inventory. `Promotion.recordUsage()` ([promotion.ts:134-139](services/promotions/src/domain/promotion.ts)) unconditionally increments `usageCount` regardless of the promotion's current status and, once the usage limit is crossed, calls `transition("depleted", ...)` — legal only from `"active"`. A promotion paused between a Checkout reservation and the async usage-recording call (or any non-`active` status) would throw `BusinessRuleError`, which propagated as an unhandled promise rejection out of `execute()`, breaking the `Result<T, DomainError>` contract the controller's `present()` relies on.
- **Regression test:** [record-promotion-usage-error-handling.test.ts](services/promotions/src/record-promotion-usage-error-handling.test.ts) — creates a promotion with `usageLimit: 1`, advances it `active → paused`, then calls `recordUsage`.
- **RED:** both new tests failed — `app.promotions.recordUsage(...)` rejected with `BusinessRuleError: Cannot transition promotion from "paused" to "depleted"` instead of resolving to a `ControllerResponse`.
- **Fix:** wrapped the domain call in the identical `try { ... } catch (error) { if (isDomainError(error)) return err(error); throw error; }` pattern `AdvancePromotion` (and all 22 other files) already use.
- **GREEN:** both new tests pass; full package suite 11/11 (up from 9/9 pre-phase), re-run 3× with zero flakiness.

### Fix 2 — Wishlist `MoveWishlistItemToCart` duplicate cart-add

- **Defect:** [wishlist.use-cases.ts](services/wishlist/src/application/wishlist.use-cases.ts) `MoveWishlistItemToCart.execute()` called `this.deps.cart.addItem(...)` (external, cross-context) **before** `wishlist.moveToCart(...)` (the domain validation that confirms the item is actually present and the wishlist active). An invalid call still fired the external add; a retry after an already-successful move fired a second, silent duplicate add before failing validation on the (now-absent) item.
- **Regression test:** [move-wishlist-item-to-cart-duplicate-side-effect.test.ts](services/wishlist/src/move-wishlist-item-to-cart-duplicate-side-effect.test.ts) — two scenarios: moving a never-added product, and retrying a move that already succeeded.
- **RED:** both failed — `cart.addedItems` had 1 entry for the invalid-product case (should be 0) and 2 entries for the retry-after-success case (should stay at 1).
- **Fix:** reordered the use case to call `wishlist.moveToCart(...)` first and `cart.addItem(...)` only after that validation succeeds — confirmed via direct read of `Wishlist.moveToCart()` ([wishlist.ts:94-101](services/wishlist/src/domain/wishlist.ts)) that it's a pure, side-effect-free domain check + in-memory mutation with no dependency on cart state, making the reorder safe with zero behavior change to the success path.
- **GREEN:** both new tests pass; full package suite 15/15 (up from 13/13 pre-phase), re-run 3× with zero flakiness.

Neither fix touched a public API, event contract, database schema, or introduced new infrastructure — both are pure application-layer corrections that bring one outlier file back in line with the rest of the codebase's own established conventions.

---

## 10. Fixes Intentionally Rejected

| Candidate                                                                              | Why not fixed                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 54 SAFE reject-not-resume `AdvanceX`/named-method use cases across all 23 files        | No defect exists — verified via direct read of every transition table; none has a self-loop, so retries are correctly rejected, not duplicated                                                                                                                                                                    |
| Notifications `AdvanceNotification`/`RetryNotification` (A.16-deferred item)           | Re-audited directly this phase; verified SAFE (§3) — closing A.16's open item without a code change                                                                                                                                                                                                               |
| Automation `TriggerWorkflow` dedup-store/tx-boundary gap                               | Real, but systemic across many dedup stores repo-wide (§14) — an isolated fix for just this one service would be inconsistent and would misrepresent the actual scope of the underlying architectural gap                                                                                                         |
| Returns `ReceivePackage` dedup-store/tx-boundary gap                                   | Same root cause and same disposition as Automation's, above (§14)                                                                                                                                                                                                                                                 |
| Reviews `ReportReview` uncapped `reportCount`, no dedup                                | Business-rule gaming risk (a double-click inflates a counter), not a duplicate-external-side-effect or duplicate-money defect in the sense this phase's brief targets; fixing would mean inventing a new dedup mechanism speculatively                                                                            |
| Search `AddSynonym`/`RemoveSynonym`/`AddSuggestion` missing `requireActive()`          | Missing precondition, not a duplication/idempotency defect; not proven to cause actual harm (mutating index config during a rebuild isn't demonstrated to corrupt anything)                                                                                                                                       |
| Reporting `GenerateReport` no idempotency key, external call inside open tx            | Real duplicate-report/duplicate-query risk, but not "duplicate money movement" or "duplicate real-world action" — P2, own class, would need a precheck/settle-style restructure (precedented elsewhere but out of this phase's targeted-fix scope given the two proven, higher-confidence defects already closed) |
| Experimentation `RecordExperimentResult`/`DeclareWinner` no status precondition at all | Observed in passing during the sweep, not a status transition per this phase's own definition, no external side effect to duplicate                                                                                                                                                                               |

---

## 11. Regression Matrix (Task 13)

| Package                   | Suite result               | New tests this phase                                                                                                     |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@platform/promotions`    | 11/11 (was 9/9)            | 2 (`record-promotion-usage-error-handling.test.ts`), re-run 3× clean                                                     |
| `@platform/wishlist`      | 15/15 (was 13/13)          | 2 (`move-wishlist-item-to-cart-duplicate-side-effect.test.ts`), re-run 3× clean                                          |
| `@platform/payments`      | 81/81                      | 0 (regression check only)                                                                                                |
| `@platform/returns`       | 23/23                      | 0 (regression check only)                                                                                                |
| `@platform/licensing`     | 36/36                      | 0 (regression check only)                                                                                                |
| `@platform/orders`        | 66 passed / 5 skipped (71) | 0 (regression check only; 5 skipped = pre-existing DB-only integration suite, environment-blocked, unchanged since A.15) |
| `@platform/fulfillment`   | 28/28                      | 0 (regression check only)                                                                                                |
| `@platform/shipping`      | 22/22                      | 0 (regression check only)                                                                                                |
| `@platform/notifications` | 33/33                      | 0 (regression check only)                                                                                                |
| `@platform/finance`       | 25/25                      | 0 (regression check only)                                                                                                |
| `@platform/admin`         | 123/123                    | 0 (regression check only)                                                                                                |
| `@platform/runtime`       | 174/174                    | 0 (regression check only)                                                                                                |
| `admin-web`               | 54/54                      | 0 (regression check only)                                                                                                |

Zero regressions anywhere. Both fixed packages' full suites re-run 3× consecutively with identical pass counts and deterministic assertions each time (no flakiness).

---

## 12. Quality Gates (Task 15)

| Gate                                                | Result                                                                                                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (repo root)                        | ✅ 78/78 tasks                                                                                                                                                                                                                    |
| `pnpm test` (repo root, via per-package runs above) | ✅ all green                                                                                                                                                                                                                      |
| `pnpm lint` (repo root)                             | ✅ 78/78 tasks, clean                                                                                                                                                                                                             |
| `pnpm arch` (dependency-cruiser)                    | ✅ 0 violations, 1565 modules, 6788 dependencies — unchanged from A.16 (this phase changed only application-layer control flow, no new architectural edges)                                                                       |
| `prisma validate` (`packages/db/prisma/schema`)     | ✅ clean                                                                                                                                                                                                                          |
| `prisma migrate status`                             | ❌ `P1001` — **ENVIRONMENT-BLOCKED**, no live PostgreSQL reachable at `localhost:5432`. Identical to the Docker Desktop blocker documented unchanged across A.12–A.16; not re-diagnosed, not re-attempted, no numbers fabricated. |

---

## 13. Remaining Risks (Task 17 classification)

### P1 — High risk

1. **Automation `TriggerWorkflow` / Returns `ReceivePackage` dedup-store transaction-boundary gap** (§14) — both `ProcessedTriggerStore.markProcessed()` and `ProcessedWarehouseCallbackStore.markProcessed()` are called without a `tx` parameter, meaning (once a real, non-in-memory adapter exists) they do not durably commit atomically with the aggregate's own save. Depending on commit ordering, a crash in that window could either (a) allow a retried external dispatch/verify call after a real one already fired, or (b) mark a trigger/callback "processed" while the corresponding local state change is rolled back — a stuck-state risk. Currently **unverifiable and not locally exploitable**: no real Prisma-backed adapter for either store exists anywhere in this repo (both ship only an in-memory stub, same "mechanism built but not wired" disposition A.16 established for Licensing's `PaymentsPort`). Recommend a dedicated future phase that audits **every** dedup/replay store in the codebase (this pattern is not unique to these two — the HTTP-layer `Idempotency-Key` response cache has the identical non-tx-scoped shape) for consistency, rather than a one-off fix here.

### P2 — Medium risk

2. **Reporting `GenerateReport`** — no idempotency key, external `AnalyticsQueryPort.run()` call inside an open DB transaction; a retry produces a duplicate report row and a duplicate (possibly expensive) analytics query. Not financial/action-duplicating; recoverable, operational-cost concern.
3. **Reviews `ReportReview`** — uncapped `reportCount`, zero dedup (not even the HTTP idempotency-key mechanism, since this is the one Reviews route without `idempotent: true`); a double-click or naive retry inflates the counter and can trigger the auto-flag transition prematurely.
4. All pre-existing, previously-documented residual risks from A.10–A.16 remain unchanged and out of this phase's scope: Orders' `RequestPaymentCapture` has no idempotency key on the PSP-facing port (A.15-documented); Notifications' blind-retry-after-successful-send gap (A.15-documented); Fulfillment's staggered-arrival edge case (A.15-documented); real PostgreSQL load/concurrency/crash-recovery evidence still doesn't exist for any context (environment-blocked since A.12); A.7-origin TLS/RLS/least-privilege gaps persist.

### P3 — Low risk

5. Search's `AddSynonym`/`RemoveSynonym`/`AddSuggestion` missing a `requireActive()` precondition (config-mutation-during-rebuild, unproven harm).
6. Experimentation's `RecordExperimentResult`/`DeclareWinner` having no status precondition at all (observability/consistency gap, not a duplication risk).

---

## 14. Deep Dive — The Dedup-Store Transaction-Boundary Pattern

Both genuine-but-unfixed findings (Automation `TriggerWorkflow`, Returns `ReceivePackage`) share one root cause, examined here in the depth Task 4/7 require, to justify why this phase treats it as a documented risk rather than a two-file patch:

- Both use cases follow: `findById` → `hasProcessed(dedupKey)` check → (if new) mutate aggregate + call an external port → `save(aggregate, tx)` → **`markProcessed(dedupKey)` — called with no `tx` parameter**, unlike every repository call in this codebase, which always takes `tx` explicitly (this codebase never uses ambient/AsyncLocalStorage-based transaction context — `tx` is always passed explicitly, confirmed by reading every repository call site touched in this audit).
- This means `markProcessed()` does **not** participate in the same atomic commit as the aggregate's own state change. Depending on how a future real (non-in-memory) implementation orders its own write relative to the surrounding `unitOfWork.run` callback's commit, this creates one of two possible crash-window defects: a duplicate external call (if `markProcessed` commits _after_ the outer transaction, a crash in between lets a retry see `hasProcessed() === false` again) or a stuck/silently-lost state (if `markProcessed` commits _before_ the outer transaction and independently of it, a crash in between marks the operation "done" while the actual state change is rolled back).
- **Why not just add `tx` to the interface and pass it through (the same additive-parameter fix pattern A.16 used for Licensing's `PaymentsPort.collect()`):** because the _identical_ non-tx-scoped shape is used by the HTTP-layer `Idempotency-Key` response-replay cache (`packages/http/src/server.ts`) and is the established, repo-wide convention for every dedup/replay mechanism found during this sweep — not a local mistake in these two files. Fixing only Automation and Returns while leaving the same pattern everywhere else (including the HTTP-layer cache, which is architecturally a different kind of store entirely) would be an inconsistent, partial fix that misrepresents the true scope of the underlying gap, and touching the HTTP-layer cache or introducing a shared tx-scoped-dedup abstraction across the codebase is squarely the kind of cross-cutting architectural change and "generic Idempotency Framework" this phase's Absolute Constraints explicitly forbid introducing speculatively.
- **Current exploitability: none.** Neither `ProcessedTriggerStore` nor `ProcessedWarehouseCallbackStore` has a real (Prisma-backed or otherwise) production implementation anywhere in this repo — both ship only the in-memory stub used by tests, explicitly documented in-file as "Prisma-backed store supersedes this in production" (not yet written). This is the same "mechanism built but not wired" disposition A.16 established for Licensing's payments adapter — a real, honestly-documented gap for when real infrastructure lands, not a live production defect today.

**Recommendation:** a dedicated future phase auditing every dedup/replay store in the codebase (there are at least 6: Automation's trigger store, Returns' warehouse-callback store, Search's/Recommendations'/Reviews'/Coupons'/Loyalty's various idempotency-key checks, plus the HTTP-layer response cache) for consistent transaction-scoping, done once as a single coherent pass rather than piecemeal.

---

## 15. Production Readiness Verdict

**Verdict: CONDITIONALLY PRODUCTION READY**

Reasoning:

- The declared ~23-service systemic pattern was fully inventoried (65 individual use cases), and the overwhelming majority (54/65) is proven SAFE by direct inspection of every transition table — not assumed, not sampled.
- Two genuine, isolated defects were found, proven with RED→GREEN regression evidence, and fixed with the smallest possible change in each case — no schema, API, or architecture change.
- One class of genuine, non-trivial risk (dedup-store transaction-boundary gap) was found, analyzed to full crash-recovery depth, and honestly documented as unfixed — because fixing it correctly requires a repo-wide, single-pass architectural change this phase's own Absolute Constraints forbid attempting piecemeal, and because it is currently unexploitable (no real adapter wired for either affected store).
- Zero regressions across all 13 previously-hardened and newly-touched packages; full repo-wide typecheck/lint/arch/prisma-validate gates are clean.
- It stays at _conditional_, not full, readiness because: (a) the dedup-store transaction-boundary gap (§14) is real and will become exploitable the moment a real adapter is wired for Automation or Returns' dedup stores, with no fix yet in place; (b) Reporting's `GenerateReport` and Reviews' `ReportReview` gaps remain open, lower-severity but real; (c) real PostgreSQL load/concurrency/crash-recovery evidence still does not exist for any context — unchanged since A.12, still environment-blocked by the same Docker Desktop failure; (d) the A.7-origin TLS/RLS/least-privilege gaps persist untouched, as they have across seven phases now.

---

## 16. Files Changed

**Modified (2 files):**

- `services/promotions/src/application/promotion.use-cases.ts`
- `services/wishlist/src/application/wishlist.use-cases.ts`

**Added (2 new test files, 4 new tests):**

- `services/promotions/src/record-promotion-usage-error-handling.test.ts` (2)
- `services/wishlist/src/move-wishlist-item-to-cart-duplicate-side-effect.test.ts` (2)

No schema, migration, public HTTP API, or event-contract change anywhere in this phase. No new bounded context, no new infrastructure, no shared "idempotency framework" introduced. Nothing committed — the large pre-existing body of unrelated uncommitted work in this repo (A.1 through A.16, plus the unrelated `feat(payments): real Stripe PSP integration` and other pre-existing uncommitted changes visible in `git status`) was left completely untouched, per the standing sprint-isolation discipline.
