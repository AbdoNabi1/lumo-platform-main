# Phase A.13.1 — Returns Refund Transaction-Boundary Closure

## 1. Executive Summary

`Returns.DecideResolution` called `PaymentsPort.requestRefund` — which internally makes a live
Stripe network call — from _inside_ its own open Prisma transaction. The transaction (and the DB
connection it held) stayed open for the entire duration of the nested Payments reserve → PSP call →
settle sequence. This phase closes that gap by moving only the `PaymentsPort.requestRefund` call to
after Returns' own transaction commits. No other behavior, API, or mechanism changed. A deterministic
instrumentation test proves the defect existed (fails against the pre-fix code) and proves the fix
(passes against the post-fix code). All regression suites across Returns, Payments, Admin, and
Runtime remain green. Nothing is committed.

## 2. Original Vulnerability

`DecideResolution.execute` (`services/returns/src/application/return-lifecycle.use-cases.ts`) opened
a Prisma interactive transaction via `this.deps.unitOfWork.run(async (tx) => {...})` and, inside that
same callback, `await`ed `this.deps.paymentsPort.requestRefund(...)`. That call chains into
`PrismaPaymentsPortAdapter.requestRefund` (`apps/runtime/src/composition.ts`) →
`PaymentController.refundLifecycle` → `RefundPaymentLifecycle.execute`
(`services/payments/src/application/payment-lifecycle.use-cases.ts`) → a live HTTP `fetch` to Stripe
(`packages/psp-stripe/src/stripe-payment-provider.ts`). Because the whole chain was awaited inside the
Returns transaction's callback, Prisma could not issue `COMMIT` until the entire nested
reserve-commit → PSP HTTP round-trip → settle-commit sequence finished — holding a Postgres
connection open for the duration of an external network call. This is the same class of defect
already fixed in Payments' own `CreatePaymentIntentLifecycle` (Phase A.13), `RefundPaymentLifecycle`
(Phase A.4), and `CapturePaymentLifecycle` (Phase A.8) — except none of those fixes protected the
_outer_ Returns transaction, because nothing about Payments' internal short transactions changes how
long the caller's own transaction stays open around the call.

The runtime adapter's own doc comment already admitted this (pre-fix):

> "Atomicity note: this call happens _inside_ Returns' own `DecideResolution` Prisma transaction... none of these are atomically joined with Returns' own transaction."

## 3. Evidence

Call chain traced end-to-end (file : line, pre-fix):

| Step | File                                                                           | Method                                                                            |
| ---- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1    | `services/returns/src/application/return-lifecycle.use-cases.ts:383` (pre-fix) | `DecideResolution.execute` opens `unitOfWork.run(async (tx) => {...})`            |
| 2    | same file, line 427 (pre-fix)                                                  | `await this.deps.paymentsPort.requestRefund(...)` called **inside** that callback |
| 3    | `apps/runtime/src/composition.ts:363-419`                                      | `PrismaPaymentsPortAdapter.requestRefund` → `this.payments.refundLifecycle(...)`  |
| 4    | `services/payments/src/interfaces/payment.controller.ts:83-85`                 | `PaymentController.refundLifecycle`                                               |
| 5    | `services/payments/src/application/payment-lifecycle.use-cases.ts:520-554`     | `RefundPaymentLifecycle.execute`                                                  |
| 6    | same file, line 542-546                                                        | `await this.deps.paymentProvider.refund(...)`                                     |
| 7    | `packages/psp-stripe/src/stripe-payment-provider.ts:125-169`                   | `StripePaymentProvider.refund` → real `fetch`                                     |

`prisma.$transaction(fn)` (used by `PrismaUnitOfWork.run`, `packages/db/src/prisma-repository.ts:34-44`
and `packages/db/src/transaction.ts:15-24`) only commits after the promise returned by `fn` resolves.
Since step 2's `await` sat inside that `fn`, the outer transaction was provably still open through
steps 3-7.

**New deterministic proof** (`services/returns/src/application/decide-resolution-transaction-boundary.test.ts`,
"Task 2/12" describe block): a `TrackingUnitOfWork` counts currently-open `run()` calls (identical
convention to Payments' own `create-intent-transaction-boundary.test.ts`, Phase A.13) and a
`RecordingPaymentsPort` records that count at the moment `requestRefund` is invoked.

Run against the pre-fix code (temporarily reverted, then restored — not committed either state):

```
× EXPLOIT: openCountAtCall is 0 → expected 1 to be +0
× ordering trace → expected ['BEGIN','PSP CALL','COMMIT'] to equal ['BEGIN','COMMIT','PSP CALL']
× PSP failure: openCountAtCall is 0 → expected 1 to be +0
 Tests  3 failed | 4 passed (7)
```

Run against the post-fix code:

```
✓ decide-resolution-transaction-boundary.test.ts (7 tests) 25ms
 Tests  7 passed (7)
```

This is the required **fails before → passes after** evidence.

## 4. Existing Safe Pattern

`RefundPaymentLifecycle.execute` (Phase A.4) already splits into three independently-committed
steps: `reserve()` (`payment-lifecycle.use-cases.ts:556-595`, its own `unitOfWork.run`), the PSP call
itself (541-546, zero open transaction), and `settle()` (597-643, a second independent
`unitOfWork.run`). This pattern is correct _in isolation_ and was reused completely unchanged —
Phase A.13.1 does not touch `RefundPaymentLifecycle`, `CapturePaymentLifecycle`, or
`CreatePaymentIntentLifecycle` at all. The defect was purely that Returns invoked this
already-correct mechanism from inside its own, separate, still-open transaction — nesting a
short-transaction pattern inside a long-lived caller transaction does not shorten the caller's
transaction.

## 5. Transaction Ownership

The transaction is opened directly by `DecideResolution.execute` itself (not the repository, not an
HTTP/adapter layer, not a decorator), via `ReturnLifecycleDeps.unitOfWork: TransactionalUnitOfWork<unknown>`
— a `PrismaUnitOfWork` instance built once in `services/returns/src/composition.ts:150` and threaded
through every Returns lifecycle use case. The fix preserves this: the transaction still exists, still
wraps every DB write that must be atomic (the return's load, eligibility check, and resolution-decision
write), and is still owned by `DecideResolution`. Only the point at which `paymentsPort.requestRefund`
is invoked moved to after that transaction's callback returns.

## 6. Before Flow

```text
BEGIN
  load return
  refund-eligibility check (RefundVerificationPort)
  returnRequest.decideResolution() [in-memory]
  save(returnRequest)               -- write A
  paymentsPort.requestRefund(...)   -- reserve-commit + Stripe HTTP call + settle-commit, ALL nested here
  notifyBestEffort(...)
COMMIT
```

## 7. After Flow

```text
BEGIN
  load return
  refund-eligibility check (RefundVerificationPort)
  returnRequest.decideResolution() [in-memory]
  save(returnRequest)               -- write A
  (non-refund outcomes only: notifyBestEffort here)
COMMIT
-- refund outcomes only, below, run AFTER commit --
paymentsPort.requestRefund(...)     -- reserve-commit + Stripe HTTP call + settle-commit (unchanged internally)
notifyBestEffort(...)
```

## 8. Files Changed

- [services/returns/src/application/return-lifecycle.use-cases.ts](services/returns/src/application/return-lifecycle.use-cases.ts) — `DecideResolution.execute` restructured: the refund request (and its trailing notify) moved outside `unitOfWork.run(...)`. Non-refund outcomes (`replacement`/`repair`) are byte-for-byte unchanged (still one transaction, unchanged ordering). No other use case in this file (`AdvanceReturn`, `DecideApproval`, `GenerateRma`, `ReceivePackage`, `InspectItems`, `AcceptItems`) was touched.
- [apps/runtime/src/composition.ts](apps/runtime/src/composition.ts) — updated `PrismaPaymentsPortAdapter`'s doc comment (the "Atomicity note") to describe the corrected boundary; zero behavioral change to the class itself.
- [services/returns/src/application/decide-resolution-transaction-boundary.test.ts](services/returns/src/application/decide-resolution-transaction-boundary.test.ts) — new test file (7 tests): exploit/fix proof, PSP-failure recovery, resolution-semantics/idempotency regressions.

No public API changed: `PaymentsPort.requestRefund`'s signature, `RefundPaymentLifecycle`, and every
other Payments/Returns interface are untouched. No new bounded context, event contract, or
infrastructure was introduced.

## 9. Tests Added

All 7 in `decide-resolution-transaction-boundary.test.ts`:

1. EXPLOIT/fix proof — `openCountAtCall` is `0` when `requestRefund` fires.
2. Resolution decision durably visible (via `findById`) at the moment the PSP call fires.
3. Ordering trace — `["BEGIN", "COMMIT", "PSP CALL"]`.
4. Non-refund outcomes (`replacement`) — single transaction, `paymentsPort` never called, unaffected.
5. PSP failure — resolution decision stays committed, `execute()` still rejects, no notify fires, correct idempotency key still reached the port.
6. Zero-amount refund — still forwarded correctly with the stable `<returnId>:refund` key.
7. Duplicate decision attempt — rejected at the state machine before ever reaching `PaymentsPort` a second time (unchanged from pre-fix).

Existing test file `services/returns/src/application/decide-resolution.test.ts` (5 tests, F-04 refund-amount-ceiling regression) required **zero changes** and passes unmodified — confirming the refactor didn't alter the F-04 refund-amount-verification behavior it protects.

## 10. Exploit Proof

See Section 3. Reverting only `DecideResolution.execute` to its pre-fix body (temporarily, not
committed, then restored) turns 3 of the 7 new tests red with exactly the predicted failure mode
(`openCountAtCall` 1 instead of 0; PSP call before COMMIT in the trace). Restoring the fix turns all
7 green. This is the "fails before → passes after" evidence required by the task's success criteria.

## 11. Idempotency Analysis

The idempotency key Returns generates (`<returnId>:refund`) is constructed identically to before and
is now passed to `paymentsPort.requestRefund` from a local `refundRequest` closure variable computed
once, before the transaction runs — no new key-generation path was introduced. It still reaches
`PrismaPaymentsPortAdapter.requestRefund`'s `idempotencyKey` parameter, then
`RefundPaymentLifecycleInput.idempotencyKey`, then `PaymentIntent.requestRefund`'s resume-by-key
logic (Phase A.5, unchanged) exactly as before. Test 5/6 above assert this key verbatim. Retry
semantics (same key → resume/no duplicate PSP call; same key + different amount → rejected; failed
refund retryable) are entirely Payments-side properties of `PaymentIntent.requestRefund` /
`RefundPaymentLifecycle`, neither of which changed — they remain covered, unmodified and still green,
by `services/payments/src/refund-idempotency.test.ts` (11 tests, all passing) and
`refund-duplicate-side-effects.test.ts` (3 tests, all passing).

## 12. Concurrency Analysis

Returns performs no capacity arithmetic itself (by design — "Returns prices nothing"); all refund
concurrency protection lives in `PaymentIntent.requestRefund`'s optimistic-lock (`version`) contract,
exercised through `RefundPaymentLifecycle.reserve()`'s `withConcurrencyRetry`. That mechanism is
unmodified by this phase and remains fully covered by
`services/payments/src/refund-concurrency.test.ts` (8 tests, all passing — including the
700+700/500+500/500+600/1000+1000-against-1000 scenarios named in the task). Returns' own change
only affects _when_ it calls into this mechanism (after its own commit, not before), never _how many
times_ or _with what arguments_ — the call site, its arguments, and its once-per-`execute()`-call
cardinality are identical to pre-fix.

## 13. PSP Failure Analysis

New test ("Task 9") proves: (1) the resolution decision (`refund_requested` status + `refundDecision`)
is committed and durably visible even when the subsequent PSP call fails — this is the intended,
documented behavior change (see Section 19); (2) `DecideResolution.execute()` still rejects with the
original PSP error, preserving the caller-visible error contract; (3) Returns' own `notifyBestEffort`
is not invoked (matches pre-fix observable behavior, though for a different underlying reason — see
below); (4) Payments' own `settle()` (inside `requestRefund`, unchanged) independently records the
`Refund` as `failed` and frees `remaining()` capacity, exactly as Phase A.4/A.9 already established.

## 14. Crash Window Analysis

- **Crash A — after Returns' reservation-transaction commits, before `paymentsPort.requestRefund` is called:** Return is durably `refund_requested`; no refund was ever requested from Payments. Recoverable: an operator/process must separately retry the refund request (Returns' own state machine forbids re-entering `refund_requested` from itself — see Section 19, Remaining Risks). No infrastructure exists for this today; not invented here (in scope was explicitly "do not invent a recovery mechanism").
- **Crash B — during the PSP call:** identical to the already-analyzed Payments-side crash window from Phase A.4/A.9 (`RefundPaymentLifecycle.reserve()` already committed; PSP call in flight). Reconciliation is via the existing Stripe webhook path (`RecordWebhook`), unchanged by this phase.
- **Crash C — after PSP success, before Payments' `settle()` commits:** identical to Phase A.9's capture-crash-recovery scenario, mirrored for refunds — unchanged by this phase; Payments' webhook-driven reconciliation (unaffected) covers it.
- **Crash D — after settlement commits, before the HTTP/application response:** the refund is fully durable on both sides; only the synchronous response to the original caller is lost. A client retry re-enters `DecideResolution.execute()`, which now fails at the state-machine check (Return already `refund_requested`) rather than re-requesting the refund — same as pre-fix's "duplicate-refund guard" test, unaffected by this phase.

No new crash window was introduced between "reservation committed" and "PSP called" for Returns'
_own_ data — that gap already existed in an equivalent form (Crash A) because Returns' status write
always preceded the refund call; this phase changes only whether the PSP call is nested inside the
same transaction as that write, not whether the write happens before or after the PSP attempt.

## 15. Webhook Compatibility

`RecordWebhook`, `PaymentIntent` webhook correlation (`findByPspReference`), and refund/capture status
transitions are entirely inside Payments and were not touched. `services/payments/src/webhook-ordering-idempotency.test.ts`,
`webhook-identifier-correlation.test.ts`, and `apps/admin/src/http/payments-webhook.e2e.test.ts` all
pass unmodified. No regression was introduced or expected — this phase never changes what Payments
receives, when, or how it responds.

## 16. Performance Impact

Expected (not benchmarked — no reachable Postgres in this environment, see Section 18):

- Returns' own transaction duration drops from "one Postgres round-trip + one full Stripe HTTP
  round-trip + Payments' own two committed sub-transactions" to "one Postgres round-trip" — the
  connection is held for a small fraction of the previous duration.
- Connection-pool occupancy improves correspondingly: a Returns connection is no longer blocked on
  Stripe's network latency (typically 100s of ms, occasionally seconds under PSP degradation).
- One additional characteristic did not change: Payments' own two sub-transactions (reserve, settle)
  already existed pre-fix (Phase A.4) and are unchanged — no new DB round-trip was added anywhere in
  this phase; the fix is a reordering, not new I/O.
- No fabricated numbers are reported; a real measurement requires the PostgreSQL/Stripe-sandbox
  environment this phase's environment does not have (consistent with Phase A.12's `NOT
PRODUCTION-VERIFIED` finding for the same underlying blocker).

## 17. Architecture Impact

`pnpm arch` (`depcruise packages services --config .dependency-cruiser.cjs`): **0 violations**
(1565 modules, 6788 dependencies cruised) — unchanged from before this phase; no new bounded context,
no new cross-service dependency, no new public API surface. `PaymentsPort` (Returns' outbound port
interface) is byte-for-byte unchanged.

## 18. Quality Gates

| Gate                                                               | Result                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (services/returns, `tsc --noEmit`)                | ✅ exit 0                                                                                                                                                                                                                                                                                |
| `pnpm test` — services/returns                                     | ✅ 4 files, 23 tests passed                                                                                                                                                                                                                                                              |
| `pnpm test` — services/payments                                    | ✅ 13 files, 81 tests passed                                                                                                                                                                                                                                                             |
| `pnpm test` — apps/admin                                           | ✅ 10 files, 123 tests passed                                                                                                                                                                                                                                                            |
| `pnpm test` — apps/runtime                                         | ✅ 30 files, 174 tests passed (Postgres/Redis genuinely unreachable in this sandbox — the affected tests are designed to tolerate that, per prior phases' documented finding; no test was skipped or fabricated)                                                                         |
| `pnpm lint` (returns use-case + test file, runtime composition.ts) | ✅ 0 errors                                                                                                                                                                                                                                                                              |
| `pnpm arch`                                                        | ✅ 0 violations                                                                                                                                                                                                                                                                          |
| `pnpm prisma validate` (packages/db, placeholder `DATABASE_URL`)   | ✅ schema valid                                                                                                                                                                                                                                                                          |
| `pnpm prisma migrate status`                                       | ❌ **environment-blocked**: `P1001: Can't reach database server at localhost:5432` — no schema change was made in this phase, so this gate is unaffected by the fix; failure is pre-existing environment unavailability (Docker/Postgres not running in this sandbox), not a regression. |

No governance/duplication-check tooling beyond the above was found wired into this repo's scripts.

## 19. Remaining Risks

- **Crash-A retry gap (pre-existing, not introduced by this phase):** once a Return reaches
  `refund_requested`, its own state machine (`refund_requested: ["closed"]` in
  `services/returns/src/domain/value-objects/return-status.ts`) forbids calling `DecideResolution`
  again to retry a refund that was never actually requested from Payments (e.g. Crash A). No
  dedicated "retry the refund request for an already-decided return" endpoint exists. This gap
  existed in equivalent form pre-fix (the whole transaction would roll back on ANY failure inside it,
  including this window, leaving the return NOT at `refund_requested` and thus retryable via a fresh
  `DecideResolution` call) — post-fix, a Crash-A failure leaves the return durably at
  `refund_requested` with no refund ever requested, and no built-in retry path. This is a real,
  narrow behavior difference from pre-fix; flagged here per the "no speculative engineering" and "if
  a gap remains, document it" instructions, not fixed (would require a new operator-facing retry
  capability, which is out of this phase's scope).
- **`notifyBestEffort` on refund failure:** post-fix it never fires when the PSP call throws (same
  observable outcome as pre-fix, achieved for a different reason — see Section 13). This was not
  changed and is not newly introduced by this phase.
- Everything else audited in this phase (idempotency, concurrency, webhook handling, crash windows B/C/D) is unchanged, already covered by existing green Payments-side tests, and carries no new risk.

## 20. Production Readiness Verdict

### CONDITIONALLY PRODUCTION READY

The code-level transaction-boundary defect is fixed and proven (fails-before/passes-after evidence in
Section 3), reuses the existing proven Payments mechanism unchanged, introduces no new public API,
bounded context, or infrastructure, and leaves all A.4–A.13 regression suites green. Real
PostgreSQL/Stripe-sandbox operational verification (actual transaction-duration measurement, live
connection-pool behavior under load) remains environment-blocked in this sandbox (no reachable
Postgres — Section 18), consistent with every prior phase's documented environment limitation. The
one genuine, narrow behavior difference from pre-fix (the Crash-A retry gap, Section 19) is
documented, not fabricated as resolved, and not introduced as a new class of defect — it is the
unavoidable consequence of durably persisting the resolution decision before the external call, which
is the entire point of this phase's fix.
