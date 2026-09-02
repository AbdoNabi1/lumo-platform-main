# Phase A.16 — Remaining Production Risk Closure

**Date:** 2026-08-13
**Scope:** Close the three production risks A.15 explicitly deferred — Licensing `collect()` idempotency, Orders `RequestFulfillment` orphan-reservation, Notifications FSM defect — plus a repo-wide idempotency/transaction-boundary sweep for anything new.
**Status:** All three target risks closed with RED→GREEN regression evidence. One additional genuine defect (Licensing Finance double-post) found by the Task 9 sweep and fixed in-scope. Two classes of pre-existing, repo-wide, out-of-scope findings documented, not fixed. All quality gates green. Nothing committed.

---

## 1. Executive Summary

Phase A.15 closed all 9 known external-call-inside-transaction violations and left three risks explicitly deferred as out of scope for that phase:

1. **Licensing `collect()` had no idempotency key of any kind** — the largest residual concurrency exposure A.15 found.
2. **Orders `RequestFulfillment` had a partial-failure orphan-reservation gap** — a failed shipment call after a successful reservation call left the reservation orphaned, with a retry creating a duplicate.
3. **Notifications had a pre-existing FSM defect** — `queued -> failed` and `retrying -> failed` were missing from the transition table, so a real send-dispatch failure could never legally reach `"failed"`, and the entire retry/dead-letter/expiry pipeline was unreachable from a real failure.

This phase closed all three:

- **Licensing:** `PaymentsPort.collect()` gained an optional, additive `idempotencyKey` parameter. `CollectInvoice` now derives a deterministic `<invoiceId>:<version>:collect` key from the invoice's own pre-existing identity + optimistic-lock version — no new port, no new persisted status, no schema change. The version component ensures a genuinely new attempt (after a real decline + re-issue) gets a fresh key, while a crash-recovery/concurrent retry against the same unsettled attempt reuses the identical key.
- **Orders:** `InventoryPort.requestReservation`/`ShippingPort.requestShipment` gained a documented idempotency CONTRACT (no signature change — `orderId` was already the parameter) requiring implementers to dedupe by `orderId`. The reference `InMemoryInventoryAdapter`/`InMemoryShippingAdapter` now implement it. A retry after a partial failure reuses the same reservation/shipment ref instead of orphaning it.
- **Notifications:** `queued -> failed` and `retrying -> failed` added to the transition table (the smallest possible correction — matches what the domain's own `markFailed()`/`retry()` methods already assumed). `SendNotification.settleFailure()` gained an idempotent-resume guard (mirroring `settleSuccess()`'s existing one), required once `"failed"` became reachable to prevent a new concurrent-duplicate-failure self-transition throw.
- **Sweep finding fixed in-scope:** the Task 9 sweep found that Licensing's `CollectInvoice.execute()` posted to the Finance ledger unconditionally after `settleSuccess()`, even when `settleSuccess()` had performed a no-op resume (a losing concurrent racer) — a genuine Finance double-post under concurrency. Fixed by having `settleSuccess()` report whether it performed the actual write, and gating the Finance call on that, mirroring `CapturePaymentLifecycle.settle`'s established `if (!alreadyCaptured)` pattern.

Every fix has RED→GREEN regression evidence (temporarily reverted, confirmed the new tests fail, restored, confirmed they pass). All three fixed packages' full suites are green, all previously-hardened flows (Payments, Returns, Admin, Runtime, Fulfillment, Finance) remain green with zero regressions, and repo-wide `typecheck`/`test`/`lint`/`arch` are entirely green. Real PostgreSQL migration status remains environment-blocked exactly as A.14/A.15 documented (Docker Desktop's corrupted socket, unchanged).

**Verdict: CONDITIONALLY PRODUCTION READY** — see §15.

---

## 2. Licensing Findings

**File:** `services/licensing/src/application/billing.use-cases.ts` (`CollectInvoice`), `services/licensing/src/application/ports.ts` (`PaymentsPort`).

**What identifies a logical collection operation?** The `Invoice` aggregate's own id — durable since `CreateInvoice`, long before any `collect()` attempt. No caller-supplied identity exists or is needed.

**Did `collect()` already have an internal business identifier?** No. Unlike `paymentProvider.capture(pspRef, idempotencyKey)` or `carrierProvider.createLabel({ idempotencyKey })`, `PaymentsPort.collect(tenantRef, amount, currency)` took no key at all — confirmed by direct read of `ports.ts` before any change.

**Existing idempotency mechanism reusable?** Yes, in spirit: every other Phase A.15 site (Shipping, Fulfillment) reused a deterministic `<id>:<action>` key derived from an aggregate's own durable id, and Payments' `CapturePaymentLifecycle` established the exact `<intentId>:capture` precedent (Phase A.8). Licensing had no such key at all — this phase added one following the identical convention, extended with the invoice's optimistic-lock `version` (see below) to distinguish genuinely new attempts from retries of the same attempt.

**Is the payment-provider operation itself idempotent?** Unverifiable in this repo: `DeferredPaymentsAdapter.collect()` unconditionally throws `"not wired in this environment yet"` — no real PSP adapter exists for Licensing anywhere (confirmed via `deferred-billing-adapters.ts` and a repo-wide grep for `PaymentsPort` implementers — only the in-memory dev stub and the deferred stub exist). The fix's safety is therefore a documented MITIGATION contingent on a future real adapter honoring the idempotency key, not a formal proof — identical epistemic status to Payments' own `<intentId>:capture` key, which likewise assumes Stripe-style idempotency-key semantics.

**Concurrent identical calls?** Both racers pass `precheck()` (a plain read, no reservation write — unchanged from A.15) and both call `payments.collect()` — but now with the IDENTICAL key, so a real idempotent PSP would only move money once. `settleSuccess()`'s existing optimistic-lock retry converges both racers on one persisted `paid` row (verified, 3 repeated runs).

**Crash after PSP call, before local persistence?** The exact scenario Task 3 asks for. A crash between a successful `payments.collect()` call and `settleSuccess()`'s commit leaves the invoice at `issued` (unchanged, since nothing durable happened yet). A subsequent retry's `precheck()` re-reads the SAME `version` (nothing incremented it — the crash pre-empted the only write that would have), so it recomputes the IDENTICAL key. Verified via `collect-invoice-idempotency-crash-recovery.test.ts`'s Scenario 4 test: `provider.realEffects` stays at 1 across the crash + retry.

**Finance succeeds, local transition fails / PSP succeeds, Finance fails?** Both pre-existing, correctly handled shapes, unchanged by this phase: a `postSettlement()` failure is best-effort (caught, doesn't roll back the already-committed `markPaid`) — this was the A.15 fix for a genuine pre-A.15 bug (see A.15 report §4.1) and remains correct. A `settleSuccess()` transient-DB-failure is retried by `withConcurrencyRetry` / recoverable via caller retry, unchanged.

**Sweep-found defect fixed in the same file:** `execute()` called `financeLedger.postSettlement()` unconditionally after any `ok` `settleSuccess()` result, even when that result was a no-op resume (a losing concurrent racer finding the invoice already `paid`). Two concurrent `CollectInvoice.execute()` calls that both pass `precheck()` (the documented residual risk above) would both reach this point and both post to Finance for the SAME collection — a genuine double-post, not previously documented in A.15 (which only analyzed the PSP call's own idempotency, not the downstream Finance call's). Fixed by having `settleSuccess()` return `alreadyPaid: boolean` and gating the Finance call on `!alreadyPaid`, mirroring `CapturePaymentLifecycle.settle`'s established `if (!alreadyCaptured)` guard on its own best-effort Finance call (Phase A.9 precedent). RED→GREEN proven (`collect-invoice-idempotency-crash-recovery.test.ts`, "Task 9 sweep finding" describe block).

**Residual risk, honestly stated:** this remains a MITIGATION, not a formal safety proof, because no real PSP adapter exists to verify against. `precheck()` is still a plain read with no row lock — concurrent racers still both physically call the PSP; the fix makes that call safe (assuming PSP-side dedupe), it does not prevent the second call.

---

## 3. Orders Findings

**File:** `services/orders/src/application/order-lifecycle.use-cases.ts` (`RequestFulfillment`), `services/orders/src/application/ports.ts`, `services/orders/src/infrastructure/in-memory-port-adapters.ts`.

**Trace: reservation → external call → fulfillment state → failure handling.** `precheck()` (read-only, 404/idempotent-short-circuit/illegal-transition checks) → `inventoryPort.requestReservation(orderId)` → `shippingPort.requestShipment(orderId)`, both sequentially outside any transaction → `settle()` (its own transaction, applies `requestFulfillment(reservationRef|shipmentRef)`, the ONLY entry to `fulfillment_requested` — no intermediate status exists between `ready_for_fulfillment` and `fulfillment_requested` in `order-event.ts`'s `TRANSITIONS` table).

**Exact orphan-reservation mechanism:** if `requestReservation()` succeeds but `requestShipment()` then throws, `execute()`'s synchronous call chain never reaches `settle()` — nothing is persisted locally (no transition, no save). The order stays at `ready_for_fulfillment` with zero local record of the successful reservation. A caller retry re-runs `precheck()` (still finds no `fulfillmentRef`) and calls `requestReservation()` again — reproduced exactly by `request-fulfillment-orphan-reservation-recovery.test.ts`'s Scenario 2/4 tests.

**Does the existing reservation model support retry/release/expiration/reconciliation/idempotent reuse?** Two models exist and were both checked:

- `Order`'s own domain (`order.ts`/`order-event.ts`): no intermediate status between `ready_for_fulfillment` and `fulfillment_requested` — no durable correlation point exists there without adding a new field (a schema change).
- Inventory's own `Reservation` aggregate (`services/inventory/src/domain/reservation.ts`) + `InventoryItem.reserve()`: no find-by-reference lookup, no dedup-by-reference — calling `reserve()` twice with the same `reference` string pushes two separate `Reservation` entities. This aggregate does NOT already support idempotent reuse either.

**Minimal fix (Task 5 decision):** neither existing model can close the window without new durable state, so per the task's own decision procedure, the fix reuses `orderId` — already the sole parameter both ports receive, no signature change — as a natural idempotency key, pushed onto the PORT/ADAPTER boundary (the same seam Licensing's `collect()` and Shipping/Fulfillment's carrier calls already use). `InventoryPort`/`ShippingPort` now carry a documented contract: implementers MUST dedupe by `orderId` alone. The reference `InMemoryInventoryAdapter`/`InMemoryShippingAdapter` (the only implementations anywhere in this repo — no real Inventory/Shipping adapter is wired) now correctly implement it (`Map<orderId, result>`, return the cached result on a repeat call instead of minting a new one).

**Why not a schema change:** making `InventoryItem.reserve()` itself dedupe by reference would be a cross-context domain change to a DIFFERENT bounded context (Inventory), larger in scope than a demonstrated defect in Orders' OWN calling pattern justifies. Adding a new `Order` field/status would require a migration and touch the aggregate's persisted shape for a risk that, like Licensing's, has zero live exploitability today (no real adapter wired). The port-level fix reuses an EXISTING correlation point; a schema change would invent a new one — Task 5 explicitly directs preferring the former.

**Residual, honestly stated:** this is a MITIGATION contingent on a real adapter honoring the `orderId`-keyed contract, unverifiable against a live Inventory/Shipping provider (none exists). Orders still calls `requestReservation()` again on every retry (an avoidable extra round-trip) — the fix makes that call safe, not free. Residual Risk #2 (concurrent racers both reaching both ports before either commits) is unchanged in kind — still happens — but no longer produces a DUPLICATE reservation/shipment, only a duplicate (safe, deduped) call.

---

## 4. Notifications Findings

**File:** `services/notifications/src/domain/value-objects/notification-status.ts`, `services/notifications/src/application/notification-lifecycle.use-cases.ts`.

**Exact invalid transition:** `queued -> failed` and `retrying -> failed` were both absent from `TRANSITIONS`. Only `sent -> failed` was legal (a POST-send delivery bounce/callback). `SendNotification` dispatches from `queued` (first attempt) or `retrying` (a subsequent attempt) — confirmed by reading `SendNotification.precheck()`, which computes `channel`/`idempotencyKey` from whichever status the notification is currently in, with no status gate of its own.

**Traced: domain entity → transition method → use case → repository → retry behavior.**

- Domain: `Notification.markFailed()` calls the generic `transition("failed", ...)`, gated by `canTransitionNotification(from, "failed")` — this was always `false` from `queued`/`retrying`.
- Use case: `SendNotification.settleFailure()` calls `markFailed()` unconditionally inside a try/catch that converts the resulting `BusinessRuleError` to `err(...)` — so a real provider-dispatch failure produced `err(BUSINESS_RULE)`, never the `ok({status:"failed"})` the code's own shape assumed.
- Retry pipeline: `RetryNotification.execute()` → `Notification.retry()` — this method's OWN internal logic (`transition("retrying"|"dead_letter"|"expired", ...)`) only succeeds when current status is `"failed"` (the only status listing all three as legal targets). Since a dispatch failure could never legally reach `"failed"`, `RetryNotification` was UNREACHABLE from a real send failure — only from a `sent -> failed` bounce.

**Classification (Task 7):** illegal-transition-incorrectly-rejected. This is not a deliberate business rule — the domain's own `markFailed()` and `retry()` methods, and the entire `RetryNotification`/dead-letter/expiry pipeline, were designed assuming `queued -> failed`/`retrying -> failed` are legal. The class doc's own lifecycle description (`"created → queued → sent → delivered; failed → retrying/dead_letter/expired"`) directly names this as the intended flow. The transition table was simply missing two entries.

**Fix:** added `"failed"` to `queued`'s and `retrying`'s transition lists — the smallest possible correction, no new states, no new methods, no schema change.

**Second defect surfaced by the fix, fixed in the same pass:** once `"failed"` became reachable, `settleFailure()`'s unconditional `markFailed()` call exposed a NEW race: two concurrent `SendNotification.execute()` calls whose provider calls BOTH fail would have the second racer call `markFailed()` on an ALREADY-`failed` notification — `failed` has no self-transition (`TRANSITIONS.failed` doesn't list `"failed"`) — throwing `BusinessRuleError` instead of a safe no-op resume. This is the exact class of defect Phase A.9 fixed for `RecordWebhook` and A.11 fixed for `AuthorizePayment`. Fixed by adding an idempotent-resume guard (`if (notification.status.value !== "failed")`) mirroring `settleSuccess()`'s existing `!== "sent"` guard.

**Duplicate/retry/terminal-state handling, verified (not assumed):**

- Duplicate event: a second `SendNotification.execute()` against an already-`failed` notification is a safe no-op (no second attempt recorded).
- Retry event: the full `queued -[fail]-> failed -[retry]-> retrying -[send]-> sent` pipeline now works end-to-end, verified.
- Terminal-state event: `delivered`/`dead_letter`/`cancelled`/`expired` remain correctly terminal — a further transition attempt from any of them still throws, unweakened.
- Concurrent duplicate: 3 concurrent `SendNotification` calls whose providers all fail converge to exactly one recorded `"failed"` attempt, no uncaught `ConcurrencyError`, deterministic final state (3 runs).

---

## 5. Crash-Recovery Matrix (Task 12)

| Flow                    | Before external call                                                           | During external call                                                                                     | After external success, before local commit                                                                                                                                                                                                                                                                                                                                                                                                                  | Retry                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Licensing Collect**   | Expected/actual: `issued`, unchanged. No tx open (precheck already committed). | Expected/actual: `issued`; no DB tx held during the PSP round-trip (A.15 fix, unregressed).              | Expected: pending settle. Actual: PSP charged for real, local still `issued`. Recovery: `settleSuccess()` on retry. Duplicate risk: retry recomputes the SAME `<id>:<version>:collect` key (nothing incremented `version`) — PSP-side dedupe assumed, unverifiable (no real adapter).                                                                                                                                                                        | **Retry-safe, verified.** `collect-invoice-idempotency-crash-recovery.test.ts`, 7/7 green, RED→GREEN proven.                                                                               |
| **Orders Fulfillment**  | Expected/actual: `ready_for_fulfillment`, unchanged. No tx open.               | Expected/actual: `ready_for_fulfillment`; no tx held during either network call (A.15 fix, unregressed). | Expected: pending settle. Actual: reservation and/or shipment succeeded externally, local still `ready_for_fulfillment` if the SECOND call failed. Recovery: retry re-calls both ports. Duplicate risk: `orderId`-keyed idempotency contract on `InventoryPort`/`ShippingPort` reuses the SAME ref — mitigation, contingent on adapter compliance (no real adapter wired).                                                                                   | **Retry-safe, verified.** `request-fulfillment-orphan-reservation-recovery.test.ts`, 8/8 green, RED→GREEN proven.                                                                          |
| **Notifications Event** | Expected/actual: `queued`/`retrying`, unchanged. No tx open.                   | Expected/actual: `queued`/`retrying`; no tx held during the provider round-trip (A.15 fix, unregressed). | Expected: pending settle. Actual: provider succeeded/failed for real, local still `queued`/`retrying`. Recovery: `settleSuccess()`/`settleFailure()` on retry, BOTH now idempotent (Phase A.16 closed the failure-path gap). Duplicate risk: stable for a crash-before-commit retry (same `attempts.length` → same key); **NOT stable** across a blind retry of an ALREADY-`sent` notification (unchanged pre-existing gap, `attempts.length` has advanced). | **Retry-safe for the crash window, verified.** `notification-fsm-regression.test.ts`, 10/10 green, RED→GREEN proven. Blind-retry-after-send gap remains, documented since A.15, unchanged. |

No cell was assumed safe without evidence — every "retry-safe" claim above is backed by a passing regression test in this phase's test files.

---

## 6. Idempotency Analysis

| Site                                                                 | Idempotency mechanism                               | Mechanism type                                                               | Verified against a real provider?                                                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Licensing `CollectInvoice` → `payments.collect()`                    | `<invoiceId>:<version>:collect` deterministic key   | New (Phase A.16), reuses invoice's own id + existing optimistic-lock version | No — no real PSP adapter wired for Licensing anywhere in this repo                                                               |
| Orders `RequestFulfillment` → `requestReservation`/`requestShipment` | `orderId`-keyed dedupe contract on the port/adapter | New (Phase A.16), reuses the pre-existing `orderId` parameter                | No — no real Inventory/Shipping adapter wired for Orders anywhere in this repo                                                   |
| Notifications `SendNotification` → provider `.send()`                | `<id>:attempt:<attempts.length>` deterministic key  | Pre-existing (A.15), unchanged                                               | Not applicable — provider-side dedupe was never Notifications' gap; the gap was the FSM rejecting the failure outcome, now fixed |
| Licensing `CollectInvoice` → `financeLedger.postSettlement()`        | `alreadyPaid` guard at the call site                | New (Phase A.16 sweep fix)                                                   | N/A — internal guard, not provider-dependent                                                                                     |

No second idempotency system was invented anywhere in this phase. Every fix reuses whatever durable identity already existed (an aggregate's own id, its optimistic-lock version, or a parameter already being passed) — consistent with A.15's own established convention.

---

## 7. Transaction-Boundary Analysis

Re-ran the A.14/A.15 sweep pattern (external-call-inside-open-transaction) across the three touched files plus a repo-wide re-check (Task 10, delegated to a research pass, findings reviewed directly against source before inclusion here):

- **Licensing/Orders/Notifications:** no new violations introduced by this phase. All three fixes preserve the exact precheck-committed / external-call-outside-any-tx / settle-in-its-own-tx shape A.15 established; the Finance double-post fix and the FSM idempotent-resume guard are both internal logic changes inside already-correctly-positioned code, not new external calls.
- **Repo-wide re-check result:** zero NEW violations found in the three target contexts. Two adjacent, OUT-OF-SCOPE observations surfaced and are recorded, not fixed (§13):
  1. `services/returns/src/application/return-lifecycle.use-cases.ts`'s `AcceptItems` calls `inventoryPort.restock(...)` and `notifyBestEffort(...)` inside its open transaction. On inspection, this matches the ALREADY-established, A.15-reviewed "best-effort side effect inside the settle transaction" pattern (A.15 report §15: `notifyBestEffort`-style calls are accepted inside the transaction repo-wide because their failure never gates the aggregate's own persisted transition) — not the same class as the 9 genuine A.14/A.15 violations (where the external call's OUTCOME determined which domain transition to apply). Flagged as a capacity/connection-duration consideration, not a correctness violation, and left untouched — fixing it would mean re-litigating an already-reviewed, accepted, repo-wide pattern, out of this phase's three-target scope.
  2. `services/automation/src/application/automation.use-cases.ts`'s dispatcher call has the same shape — same disposition.

No known transaction-boundary violation of the A.14/A.15-fixed class remains in Licensing, Orders, or Notifications.

---

## 8. Financial Invariant Audit (Task 11)

- **No duplicate charge:** Licensing's PSP call now carries a stable, version-scoped idempotency key across retries of the same attempt; a genuinely new attempt (post-decline re-issue) gets a fresh key, so a legitimate retry is never permanently blocked. Mitigation, not proof (no real PSP to verify against).
- **No duplicate refund:** unchanged — out of this phase's three targets; Payments/Returns suites re-verified green (§10), no regression.
- **No duplicate collection:** same as "no duplicate charge" above — closed via the deterministic key.
- **No orphan financial reservation:** Orders' reservation/shipment refs are now reused via `orderId`-keyed dedupe on retry, instead of orphaned. Mitigation, not proof (no real adapter to verify against).
- **No impossible negative remaining balance:** not applicable to any of the three fixed flows — none tracks a partial/remaining-balance concept (Licensing collects a fixed invoice total; Orders' reservation/shipment are all-or-nothing refs).
- **No state says "completed" while the external operation never happened:** verified for all three — `markPaid`/`requestFulfillment`/`markSent` are each only applied after the corresponding external call actually resolved successfully; PSP/port failures leave the aggregate unchanged (Licensing) or leave it unchanged pending retry (Orders), and Notifications now correctly reaches `"failed"` (not silently stuck) on a real dispatch failure.
- **No external operation succeeded while local state permanently says "not attempted" without a recovery path:** this was PRECISELY the Orders orphan-reservation defect and the Notifications FSM defect this phase closed. For Licensing, the crash-before-settle window is closed by the deterministic key making the recovery retry safe.
- **Sweep-found and fixed:** Licensing's Finance double-post (§2) — a genuine "duplicate financial-side-effect-recording" defect, closed.

No new domain invariant was added anywhere; every check above reuses invariants the domain already enforces (transition tables, optimistic locking) or a guard pattern already established elsewhere in the codebase (Payments' `alreadyCaptured`-style gating).

---

## 9. RED→GREEN Evidence

| Fix                                  | RED method                                                   | RED result                                                 | GREEN result              |
| ------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------- |
| Licensing idempotency key            | Temporarily dropped the 4th arg to `payments.collect()`      | 3/6 new tests failed (exactly the key-dependent scenarios) | 6/6 (36/36 package suite) |
| Licensing Finance double-post guard  | Temporarily removed the `!alreadyPaid` gate                  | 1/1 new test failed (`finance.calls` had length 2, not 1)  | 1/1 (36/36 package suite) |
| Orders orphan-reservation mitigation | Temporarily disabled dedup in the test's own reference fakes | 6/8 new tests failed                                       | 8/8 (66/66 package suite) |
| Notifications FSM transition table   | Temporarily reverted `queued`/`retrying`'s transition lists  | 7/33 tests failed (6 new + 1 updated A.15 test)            | 33/33 package suite       |

Every revert was surgical (a single line or block, via `Edit`), never a full-file `git checkout` — an earlier attempt at file-level revert was caught mid-session because it would have wiped ALL prior uncommitted phases' work on that file (this repo has never committed A.1 through A.16); it was immediately recovered via the saved `git diff` patch before any test ran against the wrongly-reverted state, and the rest of this phase's RED/GREEN work used only targeted `Edit`/restore pairs.

---

## 10. Regression Test Results

| Package                   | Suite result               | New tests this phase                                                                                   |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@platform/licensing`     | 36/36                      | 7 (`collect-invoice-idempotency-crash-recovery.test.ts`)                                               |
| `@platform/orders`        | 66 passed / 5 skipped (71) | 8 (`request-fulfillment-orphan-reservation-recovery.test.ts`)                                          |
| `@platform/notifications` | 33/33                      | 10 new (`notification-fsm-regression.test.ts`) + 1 existing test rewritten to match corrected behavior |
| `@platform/payments`      | 81/81                      | 0 (regression check only)                                                                              |
| `@platform/returns`       | 23/23                      | 0 (regression check only)                                                                              |
| `admin-web`               | 54/54                      | 0 (regression check only)                                                                              |
| `@platform/admin`         | 123/123                    | 0 (regression check only)                                                                              |
| `@platform/runtime`       | 174/174                    | 0 (regression check only)                                                                              |
| `@platform/fulfillment`   | 28/28                      | 0 (regression check only)                                                                              |
| `@platform/finance`       | 25/25                      | 0 (regression check only)                                                                              |

The 5 skipped Orders tests are the pre-existing, DB-only `prisma-order-repository.integration.test.ts` suite (environment-blocked, same as every prior phase — unrelated to this phase's work).

---

## 11. Repository-Wide Sweep Results (Task 9/10)

A dedicated repo-wide research pass covered every `services/*/src/domain/**` FSM table and every `services/*/src/application/*.ts` outbound port call, prioritizing payments/orders/licensing/notifications/fulfillment/shipping/returns/search/finance. Findings, each independently reviewed against source before inclusion here:

**Fixed in this phase (in-scope, directly in code this phase touched):**

- Licensing Finance double-post (§2/§8) — genuine defect, closed.

**Existing documented risk (already named in a prior phase report or this phase's own class docs, unchanged):**

- Orders `RequestPaymentCapture`'s `PaymentPort.requestCapture()` has no idempotency key at all — named in that file's own "RESIDUAL RISK" comment since A.15, explicitly NOT touched by A.16 (only `RequestFulfillment` was this phase's target).
- Fulfillment `RequestReservation`'s staggered-arrival duplicate-call edge case — named in A.15 §6, unchanged.
- Notifications' blind-retry-after-successful-send re-send gap — named in A.15 §9, unchanged.
- Payments' `AdvancePayment` unconditional-transition gap — named in the A.11 report as an accepted risk because it isn't HTTP-routed.

**Already safe (verified, not just assumed):**

- Payments' `capture`/`refund`/`createIntent` PSP calls — all deterministic, intent-id-derived keys, unregressed (81/81 green).
- Shipping's `createLabel`/`voidLabel`, Fulfillment's `createShipment` — deterministic keys, unregressed.
- Returns' `requestRefund` — deterministic, return-id-derived key, unregressed.
- Search's `upsert`/`delete` — genuinely idempotent by design (A.15's own finding), unchanged.
- Orders' `MarkOrderPaid` via `PaymentCapturedConsumer` — duplicate/concurrent event correctly no-ops today (works, though via a string-matched error-message check the sweep flagged as fragile, not incorrect).

**Genuine NEW defects found, classified, and DELIBERATELY NOT fixed (out of this phase's three-target scope, per the brief's "do not fix unrelated findings automatically"):**

- `AdvanceNotification`/`RetryNotification` call the generic `transition()`/`retry()` unconditionally, no idempotent-resume guard — the same class of defect this phase just fixed for `SendNotification.settleFailure()`, left open in these two sibling entry points onto the SAME aggregate.
- The same "generic `AdvanceX` calls `transition()` unconditionally" shape recurs in roughly 23 services repo-wide (`AdvanceOrder`, `AdvancePayment`, `AdvanceShipment`, `AdvanceReturn`, `AdvanceIndex`, etc.), several of which ARE HTTP-routed with `idempotent: true` (relying entirely on the transport-layer replay cache, which only helps when the caller supplies an `Idempotency-Key` header).
- Licensing `IssueInvoice` calls `invoice.issue()` unconditionally — a duplicate issue call throws rather than no-ops. Lower severity (no external side effect to duplicate).

**Why not fixed now:** all three of these are systemic, repo-wide patterns spanning far more than the three files this phase's brief authorizes, would require touching services well outside Licensing/Orders/Notifications, and — per the Absolute Constraints ("DO NOT redesign the architecture," sprint-isolation discipline, and the engineering constitution's Rule 14 max-refactor-scope trigger) — warrant a dedicated future phase, not an opportunistic fix bundled into this one. Recorded here for exactly that purpose.

**False positives (looked risky, verified not to be):**

- Returns' `inventoryPort.restock()` running inside an open transaction — matches the ALREADY-accepted `notifyBestEffort` pattern (§7), not a genuine violation of the A.14/A.15-fixed class.
- Search's `upsert`/`delete` calls without an explicit key — the provider contract is documented as idempotent by design.

---

## 12. Quality Gate Results

| Gate                             | Result                                                                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (repo root)     | ✅ 78/78 tasks                                                                                                                                                                                                          |
| `pnpm test` (repo root)          | ✅ 78/78 tasks, all green                                                                                                                                                                                               |
| `pnpm lint` (repo root)          | ✅ 78/78 tasks, clean                                                                                                                                                                                                   |
| `pnpm arch` (dependency-cruiser) | ✅ 0 violations, 1565 modules, 6788 dependencies — unchanged from A.15 (no new architectural edges; this phase changed application-layer logic + doc comments + tests only)                                             |
| `prisma validate`                | ✅ clean (`packages/db/prisma/schema`)                                                                                                                                                                                  |
| `prisma migrate status`          | ❌ `P1001` — **ENVIRONMENT-BLOCKED**, no live PostgreSQL reachable. Identical to A.14/A.15's documented Docker Desktop corrupted-socket blocker (unchanged; not re-diagnosed, not re-attempted, no numbers fabricated). |

Individually re-verified: Licensing 36/36, Orders 66/71 (5 skipped, DB-only), Notifications 33/33, plus every previously-hardened package (§10).

---

## 13. Remaining Risks

1. **Licensing's `collect()` idempotency key is unverified against a real PSP** — no real adapter is wired anywhere in this repo for Licensing (`DeferredPaymentsAdapter` unconditionally throws). The fix is architecturally correct and matches Payments' own established convention, but cannot be proven safe against a live provider.
2. **Orders' `orderId`-keyed reservation/shipment dedupe is unverified against real Inventory/Shipping adapters** — same disposition as #1; no real adapter exists to verify against.
3. **Orders' `RequestPaymentCapture` still has no idempotency key** — A.15-documented, explicitly out of this phase's `RequestFulfillment`-only target.
4. **Notifications' blind-retry-after-successful-send gap** — A.15-documented, unchanged.
5. **`AdvanceNotification`/`RetryNotification` and the repo-wide `AdvanceX` unconditional-transition pattern (~23 services)** — genuine, newly classified this phase, deliberately not fixed (§11) — recommended as a dedicated future phase.
6. **Fulfillment `RequestReservation`'s staggered-arrival edge case** — A.15-documented, unchanged.
7. **Real PostgreSQL load/capacity/lock-contention/crash-recovery behavior remains completely unvalidated** — environment-blocked since A.12, unchanged.
8. **TLS-unenforced / RLS-absent / dead least-privilege-role findings (A.7-origin)** — unchanged, out of this phase's scope.

---

## 14. Intentionally Rejected / Deferred Fixes

| Finding                                                                         | Why deferred                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AdvanceNotification`/`RetryNotification` unconditional-transition gap          | Same class as this phase's Notifications fix, but a sibling entry point on the same aggregate, not the assigned `SendNotification` target — recommend a dedicated follow-up covering all `AdvanceX` use cases together |
| Repo-wide `AdvanceX` pattern (~23 services)                                     | Systemic, far exceeds a 3-file-target phase's scope; several instances ARE HTTP-routed and carry real (if partially-mitigated) risk — recommend a dedicated phase                                                      |
| Licensing `IssueInvoice` unconditional `issue()` call                           | Lower severity (no external side effect); not part of this phase's `CollectInvoice` target                                                                                                                             |
| Returns' `inventoryPort.restock()`/`notifyBestEffort()` inside open transaction | Matches an already-reviewed, accepted, repo-wide pattern (A.15 §15); not the same class as genuine violations                                                                                                          |
| Orders' `RequestPaymentCapture` idempotency key                                 | A.15-scoped decision (`RequestFulfillment` was this phase's Orders target, not `RequestPaymentCapture`)                                                                                                                |
| Real PostgreSQL load/capacity/crash-recovery measurement                        | Environment-blocked (Docker Desktop), unchanged since A.12; no fabricated numbers                                                                                                                                      |
| TLS enforcement, RLS, least-privilege DB role wiring                            | A.7-origin structural gaps, explicitly out of this phase's three-target scope                                                                                                                                          |

---

## 15. Production Readiness Verdict

**Verdict: CONDITIONALLY PRODUCTION READY**

Reasoning:

- All three risks this phase was assigned are closed with independently-proven RED→GREEN regression evidence: Licensing collection now has a documented, tested idempotency/recovery strategy; Orders fulfillment no longer has a demonstrated duplicate-reservation path (only an unavoidable extra, now-safe retry call); Notifications' FSM defect is understood, corrected, and its newly-exposed concurrent-duplicate-failure race closed in the same pass.
- One additional genuine defect (Licensing Finance double-post) was found by this phase's own sweep, inside code this phase already touched, and fixed with the same RED→GREEN rigor.
- No new transaction-boundary violation of the A.14/A.15-fixed class was introduced or found in Licensing, Orders, or Notifications.
- No known duplicate financial-operation path remains in any of the three target flows.
- Payments and Returns remain fully green (81/81, 23/23) — zero regression.
- Full repo-wide quality gates (typecheck/test/lint/arch) are entirely green; `prisma validate` is clean.

It stays at _conditional_, not full, readiness because: (a) both new idempotency mitigations (Licensing PSP key, Orders port dedupe) are contingent on real adapters that do not exist anywhere in this repo yet — genuinely unverifiable, not merely untested; (b) several pre-existing, honestly-documented gaps remain open by design (§13), most notably the repo-wide `AdvanceX` unconditional-transition pattern this phase's own sweep newly classified but did not fix, matching the brief's explicit "do not fix unrelated findings automatically" instruction; (c) real PostgreSQL load/concurrency/crash-recovery evidence still does not exist for any context, unchanged since A.12; (d) the A.7-origin TLS/RLS/least-privilege gaps persist untouched, as they have across six phases now.

---

## 16. Files Changed

**Modified (6 files):**

- `services/licensing/src/application/ports.ts`
- `services/licensing/src/application/billing.use-cases.ts`
- `services/orders/src/application/ports.ts`
- `services/orders/src/infrastructure/in-memory-port-adapters.ts`
- `services/orders/src/application/order-lifecycle.use-cases.ts`
- `services/notifications/src/domain/value-objects/notification-status.ts`
- `services/notifications/src/application/notification-lifecycle.use-cases.ts`
- `services/notifications/src/send-notification-transaction-boundary.test.ts` (one pre-existing A.15 test updated to assert the now-corrected behavior)

**Added (3 new test files, 25 new tests):**

- `services/licensing/src/collect-invoice-idempotency-crash-recovery.test.ts` (7)
- `services/orders/src/request-fulfillment-orphan-reservation-recovery.test.ts` (8)
- `services/notifications/src/notification-fsm-regression.test.ts` (10)

No schema, migration, public HTTP API, or event-contract change anywhere in this phase. No new bounded context, no new infrastructure. Nothing committed — preserved exactly per the standing sprint-isolation discipline; the large pre-existing body of unrelated uncommitted work in this repo was left untouched.

---

## 17. Sprint Isolation

Only the 11 files listed in §16 were changed by this phase's work. A file-level `git checkout` was briefly and mistakenly used during RED verification of the Licensing fix — caught before any test ran against the wrongly-reverted state, immediately recovered via the `git diff` patch saved moments earlier (restoring the FULL cumulative A.1–A.16 uncommitted state for that file, not just this phase's slice). Every subsequent RED/GREEN cycle in this phase used only targeted, surgical `Edit`/restore pairs — never a file-level revert — specifically to avoid repeating that mistake against a repo carrying six phases of uncommitted work.
