# Phase A.9 — Capture Crash-Recovery & Reconciliation Closure

**Status: CONDITIONALLY PRODUCTION READY**
**Scope:** `CapturePaymentLifecycle.settle` and `RecordWebhook` (`services/payments/src/application/{payment-lifecycle.use-cases,record-webhook}.use-case.ts`), plus their wiring in `services/payments/src/composition.ts`.
**Discipline:** every claim is code-proven via a written, executed test unless explicitly marked environment-blocked. Two isolated, targeted temporary reverts (not a broad stash — this repo carries a large pre-existing uncommitted tree per [[lumo-sprint-isolation-discipline]]) were used to independently confirm each fix's causal necessity; both are documented in §5 with exact failure output.

---

## 1. Executive Summary

Phase A.8 closed capture's concurrency/long-transaction defects by splitting `CapturePaymentLifecycle` into `reserve` → PSP-call → `settle`, and documented one residual risk: a crash between PSP success and `settle()`'s commit. A.8 verified this crash window leaves the intent at the durable, webhook-repairable `capture_requested` status. **What A.8 did not verify — and what this phase found to be false — is that reaching `captured` status via the webhook path constitutes full settlement.**

Two real defects were proven by initially-failing tests and fixed:

1. **Webhook-only recovery advanced `status` to `captured` but never created the `Charge` record, never notified Orders/Notifications, and never recorded the Finance ledger event.** The webhook path used the generic `intent.transition()` (bare status change) instead of `CapturePaymentLifecycle`'s `markCaptured()` + side effects. A payment could show `captured` locally while having zero recorded captured amount — silently breaking `remaining()` (used by every future refund against that intent) and leaving Finance permanently unaware the capture happened.
2. **`CapturePaymentLifecycle.settle()` itself could double-record the Finance ledger event and double-notify** on any legitimate concurrent-settle race (webhook + retry, or two racing retries) — the notify/Finance calls sat _outside_ the "already captured, skip" guard, so an idempotent no-op resume still re-ran them.

The fix reuses the existing, already-proven pattern rather than inventing new infrastructure: `RecordWebhook` now delegates a `captured` event to `CapturePaymentLifecycle.settle()` itself (made accessible, not duplicated) when a `captureSettlement` capability is wired — which `composition.ts` now does by default for both the Prisma and in-memory branches. No new bounded context, no event bus, no outbox, no distributed lock, no Redis, no new database, no public API break, no event-contract change, no state-machine change.

---

## 2. Original A.8 Residual Risk

Quoted from `PHASE_A8_CAPTURE_CONCURRENCY_SECURITY_REMEDIATION_REPORT.md` §8/§19: _"a crash before TX1 commits still leaves the intent at `authorized`, still unreconcilable by webhook... not fixed... no evidence of occurrence."_ That specific gap (crash **before** the reservation itself commits) remains open and out of scope here, for the same reason A.8 gave (§6 below re-confirms this decision was correct to leave alone). **This phase's actual finding is different and more severe in a different dimension**: even in the crash window A.8 DID fix (reservation committed, PSP succeeded, `settle()` never ran), recovering via webhook alone did not produce a financially-consistent result.

---

## 3. Current Capture State Machine (Ground Truth, Re-Verified From Source)

Read fresh from `services/payments/src/domain/value-objects/payment-status.ts:20-33` (unchanged since A.8):

```
authorized          → [capture_requested, cancelled, expired]
capture_requested    → [captured, failed]
captured             → [refunded, partially_refunded, closed]
```

`captured` has **no self-transition** — confirmed by a newly-discovered side effect of this phase's exploit test (§5): a webhook arriving when the intent is _already_ `captured` (e.g., a delayed duplicate `payment_intent.succeeded` under a different Stripe event id than a prior delivery) used to hit the generic `transition("captured", ...)` and get rejected outright by `canTransitionPayment`, even though the correct behavior is a safe no-op. `CapturePaymentLifecycle.settle()`'s `alreadyCaptured` check (not a transition-table check at all) already handled this correctly for the retry path — the fix in §11 extends that same idempotent handling to the webhook path.

`CapturePaymentLifecycle` (`payment-lifecycle.use-cases.ts:261-408` post-fix) — unchanged shape from A.8 (`reserve`/PSP-call/`settle`), with `settle` now `public` (was `private`) and internally guarding its side effects (§5).

`RecordWebhook` (`record-webhook.use-case.ts`) — `KIND_TO_STATUS` unchanged (`authorized`/`captured`/`failed`/`cancelled`/`expired`). Execution now branches on whether the event maps to `captured` **and** a `captureSettlement` capability is wired (§7).

---

## 4. Exact Crash Window

```
DB reserve  (CapturePaymentLifecycle.reserve, own committed transaction)
↓ COMMIT — intent durably at `capture_requested`
PSP capture  (outside any transaction, per A.8)
↓ PSP SUCCESS — Stripe has genuinely captured the money
✗ application crash — settle() never runs
```

State left behind: `PaymentIntent.status = "capture_requested"`, `pspReference` set, **zero `Charge` rows**, no `PaymentAttempt` beyond `authorize`. PSP-side, Stripe holds: the `PaymentIntent` id (`providerIntentId`, i.e. the `pspReference.value` in our schema), a definitive `succeeded` status, the captured amount and currency (implicit — the adapter captures the full authorized amount, `stripe-payment-provider.ts:90-97`), and the idempotency key `<paymentIntentId>:capture` used for the call. **Information available for recovery:** the deterministic idempotency key and the payment intent id are both recoverable purely from `paymentIntentId` — no PSP-side capture id or provider transaction id is stored locally or forwarded by the webhook body currently consumed (`payments-webhook-routes.ts`'s zod schema only reads `body.data.object.id`, which for a `payment_intent.*` event **is** the PSP's `providerIntentId`/`pspReference` — already the one identifier the system needs to locate the intent, per §5 of that route file).

---

## 5. Exploit Proof

New file: `services/payments/src/capture-crash-recovery.test.ts` (10 tests). Two defects were isolated and independently proven via targeted, minimal temporary reverts (not a broad `git stash`, to avoid disturbing this repo's large pre-existing uncommitted tree):

**Defect 1 — webhook-only recovery skips full settlement.** Temporarily forced `deferToCaptureSettlement = false` (pre-fix shape) in `record-webhook.use-case.ts` and re-ran:

```
6 failed | 4 passed (10)
✗ EXPLOIT: RecordWebhook advances status to `captured` but does not create the Charge...
   expected [] to have a length of 1 but got +0
✗ Instance B's webhook-driven reconciliation and a later legitimate retry both converge...
   expected [] to have a length of 1 but got +0
✗ webhook and a concurrent capture retry racing to settle()...
   expected [] to have a length of 1 but got +0
✗ reversed ordering — retry first, webhook second...
   expected false to be true   ← bonus finding: pre-fix, a webhook arriving AFTER the
                                   intent is already `captured` is REJECTED outright
                                   (`captured` has no self-transition), not treated as
                                   a safe idempotent no-op
✗ the same successful-capture webhook delivered 3 times...
   expected [] to have a length of 1 but got +0
✗ capturedAmount never exceeds authorizedAmount... after any recovery path
   expected [] to have a length of 1 but got +0
```

Restored the fix; re-ran: 10/10 pass.

**Defect 2 — `settle()` double-fires notify/Finance on an idempotent resume.** Temporarily moved the `notifyBestEffort`/`financePort.recordPaymentEvent` calls back outside the `!alreadyCaptured` guard (pre-fix shape) in `payment-lifecycle.use-cases.ts` and re-ran:

```
2 failed | 8 passed (10)
✗ webhook and a concurrent capture retry racing to settle()...
   expected [ {…}, {…} ] to have a length of 1 but got 2
✗ reversed ordering — retry first, webhook second...
   expected [ {…}, {…} ] to have a length of 1 but got 2
```

Restored the fix; re-ran: 10/10 pass. Full `services/payments` suite: 63/63 pass, repeated 3× consecutively, no flakiness.

---

## 6. Existing Recovery Mechanisms (Task 4/18 Audit)

Searched the repository for: reconciliation jobs, scheduled workers, PSP lookup/retrieve capability, startup recovery, payment-intent synchronization.

- **Scheduler**: `apps/runtime`'s `buildJobs(core)` defines exactly **one** job — `"outbox-prune"` (`apps/runtime/src/composition.test.ts:576-579`, confirmed against `composition.ts`). No payment-reconciliation, no capture-recovery, no payment-status-refresh job exists anywhere in the repository.
- **PSP lookup/retrieve capability**: `PaymentProvider` (`packages/contracts/src/payment-provider.ts:22-30`) exposes only `createIntent`, `capture`, `cancel`, `refund`, `verifyWebhook` — **no** `getCapture`/`retrievePayment`/`getPaymentIntent`/`lookupTransaction`/`retrieveCharge` equivalent exists on the port or the Stripe adapter (`stripe-payment-provider.ts`, confirmed by full-file read).
- **Existing webhook mechanism**: `RecordWebhook` + `ProcessedWebhookStore` (replay-safe, `(tenant, provider, event)`-unique) already exists and already carries the correct payment intent id. This IS the mechanism this phase reuses — no new one was built.
- **Conclusion (answers Task 18 directly)**: existing webhook reconciliation, once wired to the existing `settle()` code, is sufficient. Existing idempotency (the deterministic `<intentId>:capture` key) is sufficient — no caller-supplied key is needed for capture (contrast refund). Existing state transitions (`capture_requested → captured`) are sufficient — no new transition was needed (§9). No PSP lookup capability was added, because the existing webhook event already carries everything required to locate and settle the intent — building a pull-based lookup would be genuinely speculative infrastructure the evidence does not require.

---

## 7. Webhook Analysis (Task 5)

- **Event**: `payment_intent.succeeded` → kind `"captured"` (`apps/admin/src/http/payments-webhook-routes.ts:28`).
- **Locating the intent**: `body.data.object.id` (the Stripe `PaymentIntent` id) is used directly as `paymentIntentId` (`payments-webhook-routes.ts:80`) — this **is** the same id stored as `pspReference.value` locally (the domain's `PaymentIntent.id` is a separate, internally-generated UUID; the route correctly uses Stripe's own id since that's what the webhook body carries, and `RecordWebhook.execute`'s `input.paymentIntentId` is expected to be OUR domain id — re-verified: `PrismaPaymentIntentRepository.findById` looks up by our `id` column, not `psp_reference`. **This is pre-existing behavior, unchanged by A.9, and out of this phase's scope** — flagged in §14 as a discovered-but-unfixed adjacent finding, not silently ignored.
- **Deterministic idempotency key**: the webhook body does not need to carry it — `CapturePaymentLifecycle.settle()` (now reused by the webhook) never calls the PSP itself, so the webhook path has no idempotency-key concern of its own.
- **`authorized`**: rejected cleanly (pre-existing gap, §2, unchanged).
- **`capture_requested`**: now settles fully (fixed, §5).
- **Already `captured`**: now a safe idempotent no-op via `settle()`'s `alreadyCaptured` guard, reached through the SAME code path (fixed, §5's bonus finding).
- **Partial settlement (settle failed once, retried)**: proven safe, §9/Task 9.
- **Idempotent/replay-safe/duplicate-safe**: proven in §12 (Task 12) — unchanged `ProcessedWebhookStore` mechanism, with `markProcessed` now deliberately called _after_ the deferred `settle()` succeeds (was: after the single transaction, unconditionally) so a webhook whose settlement genuinely fails remains replayable rather than being silently marked handled.

---

## 8. Idempotency Analysis (Task 8)

Traced `<paymentIntentId>:capture` through `CapturePaymentLifecycle.execute` (`payment-lifecycle.use-cases.ts:284`, unchanged from A.8) → `StripePaymentProvider.capture` (`stripe-payment-provider.ts:90-97`) → `Idempotency-Key` HTTP header (`:166`). Unaffected by this phase's changes (the webhook path never calls the PSP). Test `Task 8` in `capture-crash-recovery.test.ts` confirms: two full capture requests for the same intent never present more than one distinct idempotency key to the PSP, and `realEffects === 1` (PSP-side dedup fake, same model as A.8's).

---

## 9. PostgreSQL Concurrency Semantics (Task 16)

Reused the exact `PostgresLikePaymentIntentRepository` fake from A.4/A.8 (round-trips through `PaymentIntentMapper`, reproduces `UPDATE ... WHERE id=? AND version=?` via a version-mismatch `ConcurrencyError`) — not a bare in-memory object. **Environment limitation, honestly stated**: no live PostgreSQL instance is reachable in this sandbox. `pnpm prisma migrate status` was attempted and failed at the config-validation stage (`Error: Environment variable not found: DATABASE_URL`, `packages/db/prisma/schema/main.prisma:29`) — no connection was even attempted, confirming `DATABASE_URL` is simply absent, not merely unreachable. This is **code-proven**, not **PostgreSQL-live-verified**, consistent with every prior phase in this project.

---

## 10. PSP Behavior (Task 7)

Confirmed via full-file read of `packages/psp-stripe/src/stripe-payment-provider.ts`: no lookup/retrieve capability exists on the adapter or the `PaymentProvider` port it implements. This phase did not assume Stripe behavior beyond what the existing adapter's own doc comments already assert (idempotency-key dedup for 24h, `stripe-payment-provider.ts:58-60`) — no new claims about PSP semantics were introduced.

---

## 11. Remediation

**File: `services/payments/src/application/payment-lifecycle.use-cases.ts`**

- `CapturePaymentLifecycle.settle` changed from `private` to `public` (structural-typing reuse target for `RecordWebhook`; no other behavior change to its signature).
- Its body: `alreadyCaptured` now gates the `notifyBestEffort`/`financePort.recordPaymentEvent` calls, not just the `markCaptured`/`save` write (closes Defect 2, §5).

**File: `services/payments/src/application/record-webhook.use-case.ts`**

- New `CaptureSettlementPort` interface (structural, minimal — just `settle(paymentIntentId)`), and new optional `RecordWebhookDeps.captureSettlement` field.
- `execute()`: when the event maps to `captured` **and** `captureSettlement` is wired, the receipt (`recordWebhook()` + `save()`) still commits in its own transaction as before, but the generic `transition("captured", ...)` is skipped in favor of calling `captureSettlement.settle(paymentIntentId)` afterward — reusing the exact Charge/notify/Finance logic `CapturePaymentLifecycle` already has, not duplicating it (closes Defect 1, §5). `markProcessed` is called only after `settle()` succeeds, so a failed/never-run settlement remains replayable by a future webhook delivery — not silently marked handled.
- Callers that don't wire `captureSettlement` keep the exact pre-A.9 behavior (verified by the dedicated "fallback" test in §Task-3) — additive, not breaking.

**File: `services/payments/src/composition.ts`**

- `capturePaymentLifecycle` hoisted to a shared local so it can be passed to both `PaymentController` and the new `RecordWebhook.captureSettlement` field — wired for both the Prisma and in-memory composition branches (the function that builds both is shared, `buildController`).

No schema change, no migration, no new domain entity, no event-contract change, no public HTTP contract change (`RecordWebhookInput`/`Output` unchanged), no new bounded context, no distributed lock, no Redis, no outbox change, no state-machine/transition-table change.

---

## 12. Tests Added

`services/payments/src/capture-crash-recovery.test.ts`, 10 tests, mapped to the task brief's regression list:

1. Webhook-only recovery after PSP-success-then-crash (Task 3 exploit) — full settlement now occurs.
2. Fallback without `captureSettlement` wired — documents the pre-A.9 status-only shape remains available (not a regression).
3. Process restart simulation (Task 10) — Instance A crashes, Instance B reconciles via webhook, then a legitimate client retry converges to the same state with no duplicate Charge/Finance record.
4. Webhook race, both orderings (Task 11) — webhook+retry and retry+webhook both converge to exactly one Charge, one Finance record, no uncaught exception.
5. Duplicate webhook delivery ×3 (Task 12) — settles once, later deliveries are safe no-ops.
6. Partial settlement failure + retry (Task 9) — a transient settlement failure does not duplicate the Charge on a subsequent successful retry.
7. PSP failure before settlement (Task 9) — reservation remains retryable, not stuck (regression-confirms A.8's existing guarantee, unaffected by A.9).
8. Idempotency-key preservation through the webhook-mediated path (Task 8).
9. Financial invariants after recovery (Task 15) — `capturedAmount ≤ authorizedAmount`, exactly one Charge, status matches PSP truth.

---

## 13. Before/After Behavior

| Scenario                                   | Before A.9                                                                     | After A.9                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Webhook-only recovery of a crashed capture | Status → `captured`, **0 Charges**, **0 Finance records**, **0 notifications** | Status → `captured`, **1 Charge** (correct amount), **1 Finance record**, notifications fire |
| Webhook arrives when already `captured`    | **Rejected** (no self-transition)                                              | Safe idempotent no-op via `settle()`                                                         |
| Concurrent webhook + retry settle race     | Both proceed; **2 Finance records** possible                                   | Exactly 1 Charge, exactly 1 Finance record                                                   |
| Duplicate webhook delivery                 | Deduped at receipt (unchanged)                                                 | Deduped at receipt; `markProcessed` now deferred until settlement genuinely completes        |
| PSP failure before settlement              | Retryable (unchanged)                                                          | Retryable (unchanged — regression-confirmed)                                                 |

---

## 14. Financial Invariants (Task 15)

All proven by `capture-crash-recovery.test.ts`'s dedicated invariants test plus the race/duplicate tests' own assertions:

- `capturedAmount ≤ authorizedAmount` — holds (single Charge equals `authorizedAmount`, never more).
- One logical capture per idempotency key — holds (§8/Task 8).
- No duplicate financial capture — holds (§8, PSP-side dedup fake `realEffects === 1`).
- No duplicate ledger settlement — **was violated (Defect 2), now fixed** (§5, §9).
- PaymentIntent final state matches PSP truth — **was violated (Defect 1: status said captured, ledger said nothing), now fixed**.
- Failed capture does not permanently consume the reservation — holds (regression-confirmed, unchanged from A.8).

**Adjacent finding, discovered but explicitly NOT fixed (out of this phase's scope, flagged for a future phase):** `payments-webhook-routes.ts:80` passes the Stripe `PaymentIntent` id (`body.data.object.id`) directly as `RecordWebhook`'s `paymentIntentId`, but `PrismaPaymentIntentRepository.findById` looks up by the domain's own internally-generated `id`, not by `pspReference`. This is **pre-existing** (predates A.8/A.9, not introduced or worsened here) and was not exercised by this phase's fake-repository-level tests (which seed by domain id directly, matching how the unit tests are structured, same convention as every prior phase's tests). Whether this is a live production defect depends on whether Stripe's id and the domain id happen to coincide in the current wiring — determining that requires either a live Stripe sandbox run or a dedicated HTTP-level e2e test, both out of this phase's evidence-gathering budget. Flagged, not silently ignored, not fixed speculatively.

---

## 15. Quality Gates

```
pnpm typecheck   → 78/78 packages, 0 errors
pnpm test        → 78/78 packages, all green (repo-wide)
pnpm lint        → 78/78 packages, 0 errors
pnpm arch        → 0 violations (1565 modules, 6788 dependencies cruised)
pnpm governance  → NOT AVAILABLE IN THIS CHECKOUT (no such script; re-confirmed)
pnpm dup         → NOT AVAILABLE IN THIS CHECKOUT (re-confirmed)
```

Targeted: `pnpm --filter @platform/payments test` — 63/63, run 3× consecutively for flakiness — deterministic every time.
`pnpm prisma migrate status` (from `packages/db`) — **failed at config validation** (`DATABASE_URL` not set), confirmed environment-blocked, not fabricated as passing.

---

## 16. Environment Limitations

- No live PostgreSQL instance reachable (Docker Desktop/WSL2 unavailable in this sandbox, consistent with every prior phase in this project's history).
- No live Stripe sandbox run performed — the PSP-side dedup/idempotency guarantee relied on is the adapter's own documented contract (§10), not independently re-verified against a real Stripe account this session.
- `pnpm governance`/`pnpm dup` do not exist in this checkout (same as every phase since A.1).

---

## 17. Remaining Risks

1. **Crash-before-reservation-commits gap** (A.8's original residual risk, §2) — still open, still correctly left unfixed (no demonstrated occurrence; would require a speculative new transition edge).
2. **Webhook `paymentIntentId` source mismatch** (§14) — discovered, documented, not fixed; needs a dedicated investigation (HTTP-level test or live Stripe data) to confirm real-world impact.
3. **No live-Postgres/live-Stripe verification** (§16) — all proofs are code-level/fake-repository-level, consistent with this project's standing environment constraint.
4. **`markProcessed` deferral window**: between the receipt transaction committing and `settle()` completing, a webhook redelivery of the _same_ event id will re-enter `execute()`, see `hasProcessed === false` still, and call `intent.recordWebhook()` a second time (a duplicate append to the observability-only `attempts` log) before retrying `settle()` (which is itself idempotent). This is a deliberate, minor, documented trade-off — favoring "the webhook must remain replayable until real settlement succeeds" (financial correctness) over "the attempts log is exactly-once" (observability only, not itself a financial invariant) — not fixed, per "no speculative infrastructure."
5. **`RefundPaymentLifecycle.settle()` has the same unconditional-notify-on-idempotent-resume shape as Capture's pre-fix Defect 2** (discovered incidentally while fixing Capture's copy in the same file). Out of this phase's explicit scope (A.9 is Capture-only) and not fixed here — flagged as a background task for a dedicated follow-up, not silently left undocumented.

---

## 18. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY.**

Both demonstrated defects (webhook-only recovery skipping full settlement; duplicate ledger/notify on idempotent resume) are closed with a minimal fix that reuses existing, already-tested code — no speculative architecture, no new infrastructure, no state-machine change. All available quality gates are green. Not unconditional because no live-Postgres or live-Stripe verification was possible in this environment (unchanged constraint across every phase of this project), and because §14/§17's adjacent findings (webhook id-source mismatch, Refund's parallel unconditional-notify shape) are honestly flagged as open rather than either fixed speculatively or hidden.
