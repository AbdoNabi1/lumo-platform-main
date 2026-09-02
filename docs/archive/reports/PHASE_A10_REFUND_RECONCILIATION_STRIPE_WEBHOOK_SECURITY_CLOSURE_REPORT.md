# Phase A.10 — Refund Reconciliation & Stripe Webhook Integrity Audit — Closure Report

## 1. Executive Summary

Phase A.10 audited the two adjacent risks Phase A.9 explicitly flagged but left unverified:
(1) whether `RefundPaymentLifecycle.settle()` can duplicate Notify/Finance side effects under
concurrency, and (2) whether the Stripe webhook route passes the wrong identifier type into
`PaymentIntentRepository.findById`. **Both were real, reproducible defects.** Both were proven with
initially-failing regression tests, fixed with the smallest change that closes the defect, and
reverified green. A third, adjacent defect was discovered during the webhook-identifier trace (Task
3/20 sweep) — Returns' two Prisma-backed refund-capacity adapters (`PrismaPaymentsPortAdapter`,
`PrismaRefundVerificationAdapter`) summed refund amounts without excluding `failed` refunds,
contrary to the domain's own `PaymentIntent.remaining()` invariant — and was fixed identically.

No new bounded context, event contract, transition, or infrastructure was introduced. All three
fixes reuse existing mechanisms (Capture's Phase A.9 `alreadyCaptured`-style guard, the existing
`PaymentIntentRepository` port, the domain's own `remaining()` filter). All fixes are additive
non-breaking changes. Full gates (typecheck/test/lint/arch/prisma validate) are green; `migrate
status`/`governance`/`dup` remain environment-blocked/non-existent exactly as every prior phase
reported — see §16.

**Verdict: CONDITIONALLY PRODUCTION READY** (§18).

## 2. Scope

In scope: `RefundPaymentLifecycle` (settlement idempotency), the Stripe webhook route and
`RecordWebhook` (identifier correlation, duplicate/malformed/signature handling), the Refund domain
invariant (`remaining()`), the full Returns → PaymentsPort → `RefundPaymentLifecycle` →
`PaymentIntent.requestRefund` idempotency-key chain, the direct `POST /payment-intents/:id/refund`
HTTP endpoint, repository/schema/transaction-boundary correctness for refund/capture, and a
repository-wide sweep for any refund/capture path bypassing the hardened lifecycle.

Out of scope (per the phase's absolute constraints, honored throughout): no new bounded context, no
outbox, no new/changed event contract, no public API changes beyond what was demonstrably required,
Orders/Customer Profile/Tracking Platform/Session Engine untouched, no speculative infrastructure.

## 3. Evidence-First Methodology

Every claim below is backed by either (a) a passing/failing automated test committed to the repo, or
(b) a direct code citation (file:line). Where a defect was fixed, the standard proof sequence was
used: write a test that demonstrates the defect against the CURRENT code → confirm it fails → apply
the smallest fix → confirm it passes → for the two headline fixes, additionally perform an isolated
temporary revert (same technique as Phase A.9) to re-confirm the failure is caused by the reverted
code specifically, not by test ordering or a stale fixture. No claim about live Postgres or live
Stripe behavior is made anywhere in this report — this sandbox has neither (§16, §17), matching every
prior Lumo phase.

## 4. Refund Settlement Trace

`RefundPaymentLifecycle` (`services/payments/src/application/payment-lifecycle.use-cases.ts:440-579`
post-fix) — reserve → PSP call → settle, same three-transaction shape Phase A.4/A.5 established:

1. **Refund row created**: `PaymentIntent.requestRefund` (`domain/payment-intent.ts:277-323`), inside
   `reserve()`'s transaction. A `pending` `Refund` entity is pushed onto `intent.refunds` and
   persisted via `PrismaPaymentIntentRepository.save`'s `refund.upsert` (keyed by `id`,
   `infrastructure/prisma-payment-intent-repository.ts:66-72`).
2. **Status changes**: `intent.status` moves to `partially_refunded`/`refunded` only inside
   `completeRefund` (`domain/payment-intent.ts:334-352`), called from `settle()`. `failRefund`
   (`:355-370`) does not change `intent.status`, only the `Refund.status`.
3. **PaymentIntent version changes**: every `save()` call inside `PrismaPaymentIntentRepository`
   increments `version` via `updateMany({ where: { id, tenantId, version }, data: { ...,
version: { increment: 1 } } })` — a genuine optimistic-lock write, not a blind update
   (`infrastructure/prisma-payment-intent-repository.ts:44-59`).
4. **Notify called**: `notifyBestEffort` (`payment-lifecycle.use-cases.ts:62-69`), from `settle()`
   only on the `succeeded` branch, gated post-fix by the new `alreadySettled` check (§5).
5. **Finance called**: **never**, for `RefundPaymentLifecycle`. `FinancePort.recordPaymentEvent` is
   called only from `CapturePaymentLifecycle.settle()` (`:370-375`) — grep-confirmed
   (`financePort` appears in this file exactly once, in Capture's settle). This is a pre-existing gap,
   not introduced or worsened by this phase — documented as a residual risk, §17, not fixed here (no
   test in this phase's brief demonstrated a duplicate Finance call for refunds because there is no
   Finance call for refunds to duplicate).
6. **PSP called**: `this.deps.paymentProvider.refund(...)` in `execute()`, strictly between the
   `reserve()` transaction committing and the `settle()` transaction opening — never inside an open
   DB transaction (§ Task 17 boundary confirmed, matches Phase A.4's original design; unchanged).
7. **Idempotency checked**: `PaymentIntent.requestRefund`'s `idempotencyKey` lookup
   (`domain/payment-intent.ts:283-298`) — resumes an existing reservation, rejects amount tampering,
   rejects resurrecting a `failed` key.
8. **Optimistic locking checked**: `withConcurrencyRetry` (`:49-60`) wraps both `reserve()` and
   `settle()`; a losing `save()` throws `ConcurrencyError`, is caught, and the whole closure retries
   against a fresh read.
9. **Webhook settlement**: **does not exist for Refund.** `RecordWebhook`'s `KIND_TO_STATUS`
   (`application/record-webhook.use-case.ts:54-60`) has no `refunded`/`partially_refunded` entry, and
   `payments-webhook-routes.ts`'s `STRIPE_TYPE_TO_KIND` (`:26-31`) has no mapping for
   `charge.refunded` either — confirmed by direct reading, and by `services/payments/src/
composition.ts:136-146` wiring only `captureSettlement`, never an equivalent refund-settlement
   port. This is by design, not a half-built mechanism (§17).
10. **Returns settlement**: traced end-to-end and confirmed intact —
    `apps/runtime/src/composition.ts:360-394`'s `PrismaPaymentsPortAdapter.requestRefund` calls
    `this.payments.refundLifecycle({ paymentIntentId, amountMinor, currency, idempotencyKey })`,
    i.e. the SAME hardened use case the direct HTTP route uses, never a legacy/bypass path.

## 5. Refund Side-Effect Idempotency

**CONFIRMED DEFECT (Task 2).** `RefundPaymentLifecycle.settle()` had no guard analogous to
Capture's Phase A.9 `alreadyCaptured` check: every call unconditionally called
`completeRefund`/`failRefund`, saved, and (on success) called `notifyBestEffort` — regardless of
whether the refund reservation was already settled. A genuine concurrent race requires TWO separate
`settle()` invocations for the SAME `refundId`, which only arises when two callers present the SAME
Phase A.5 `idempotencyKey` and their `reserve()` calls both resolve to the SAME (not-yet-completed)
reservation before either's `settle()` commits — proven with a real PSP-latency simulation
(`refund-duplicate-side-effects.test.ts`, "Scenario A").

Pre-fix: `notifications.calls` had length 2 (expected 1); the append-only attempt log had 2 `refund
succeeded` entries (expected 1) — both confirmed via a failing run before the fix, and re-confirmed
via isolated revert after.

**Fix**: `settle()` now reads the refund's current status before mutating; if it is anything other
than `pending` (i.e. already `completed` or `failed`), the write and all side effects are skipped —
a pure no-op, exactly mirroring Capture's `alreadyCaptured` pattern
(`payment-lifecycle.use-cases.ts:529-573`).

Sequential double-settlement (Task 2 Scenario C) was ALREADY safe pre-fix, because `execute()`'s
`alreadyCompleted` short-circuit (`:465-467`) prevents a second `settle()` call from ever being
reached when the resume happens after the first has already committed — confirmed by a passing test
even before the fix was applied.

## 6. Stripe Webhook Trace

```
POST /api/v1/payments/webhook (payments-webhook-routes.ts)
  → signature verify (StripePaymentProvider.verifyWebhook / verifyStripeSignature, raw bytes + header)
  → zod parse (stripeEventBody, .passthrough())
  → STRIPE_TYPE_TO_KIND[body.type] ?? body.type
  → admin.paymentsWebhook.recordWebhook({ paymentIntentId: body.data.object.id, provider: "stripe", eventId: body.id, kind })
  → RecordWebhook.execute()
      → intents.findById(paymentIntentId) ?? intents.findByPspReference(paymentIntentId)   [Phase A.10 fix]
      → ProcessedWebhookStore.hasProcessed(provider, eventId) dedup
      → intent.recordWebhook(...) + intent.transition(toStatus) OR captureSettlement.settle(resolvedDomainId)
      → intents.save(...)
      → ProcessedWebhookStore.markProcessed(...)
```

## 7. Identifier Correlation Findings

**CONFIRMED DEFECT (Tasks 4-6).** `body.data.object.id` for every `payment_intent.*` Stripe event is
Stripe's OWN PaymentIntent id (`pi_...`), which is the value passed as `RecordWebhookInput.
paymentIntentId`. `PrismaPaymentIntentRepository.findById` (`:81-98`, pre-fix and unchanged) looks up
by `id` — our internally-generated UUIDv7 (`IdGenerator`, `create-payment-intent.use-case.ts:47`),
which is NEVER equal to Stripe's id in production. The only field that ever holds Stripe's own
reference is `pspReference`, set exclusively by `AuthorizePayment` (`payment-lifecycle.use-cases.ts:
193-199`) from an ADMIN-SUPPLIED value (`authorizeBody.pspReference`, `payments-routes.ts:17-22`) —
there was no repository method to look up by it at all.

This was flagged, not proven, at the end of Phase A.9 ("this repo's unit tests sidestep it by
seeding fixtures with domain ids directly" — confirmed true: the pre-existing
`payments-webhook.e2e.test.ts` constructs `data.object.id: paymentIntentId` using the DOMAIN id, not
a Stripe-shaped one, which is why it never caught this).

Proven with `webhook-identifier-correlation.test.ts`: an intent seeded with a genuine Stripe-shaped
`pspReference` (`pi_3Nx0aB2eZvKYlo2C1aBcDeFg`), distinct from its domain UUID, receiving a webhook
addressed by that Stripe id. Pre-fix (isolated revert to `findById`-only): 2 of 4 tests failed with
`NOT_FOUND`. Post-fix: all 4 pass, and the response correctly names the DOMAIN id (not an echo of
Stripe's reference), which every other Payments endpoint also uses.

**Fix**: added `PaymentIntentRepository.findByPspReference` (Prisma: `findFirst` on
`{ pspReference, tenantId }`, backed by a new `@@index([tenantId, pspReference])`; in-memory: linear
scan). `RecordWebhook.execute()` now tries `findById` first (existing callers unaffected), falls back
to `findByPspReference`, and threads the RESOLVED domain id — never the caller-supplied
`input.paymentIntentId` verbatim — into `captureSettlement.settle()` and the response body (a second,
related bug this fix also closes: without it, `settle()` would have been called with Stripe's own
reference and failed the identical way `RecordWebhook` itself used to).

## 8. Webhook Idempotency Findings

Stripe Event IDs ARE persisted and deduplicated: `ProcessedWebhookStore` (`(tenantId, provider,
eventId)` unique constraint, `packages/db/prisma/schema/payments.prisma:53-64`), checked via
`hasProcessed`/`markProcessed` inside `RecordWebhook`'s own transaction. This is the sole
deduplication mechanism for webhooks — sufficient on its own; no additional Event-ID persistence was
added (per the phase's explicit instruction to verify sufficiency before adding anything). 10x
identical `evt_dup_1` redelivery is proven idempotent — exactly one Charge, one Finance call
(`capture-crash-recovery.test.ts`, "Task 12 — duplicate webhook delivery"); the equivalent test exists
for the identifier-correlation path too (`webhook-identifier-correlation.test.ts`, "duplicate
delivery... is idempotent").

## 9. Crash-Recovery Findings

**Capture**: fully reconciled by Phase A.9 (`captureSettlement`) — re-verified green this phase, no
regressions from the A.10 changes (`capture-crash-recovery.test.ts`, all 10 tests still pass).

**Refund**: NO webhook-driven crash recovery path exists (§4 item 9) — the only recovery mechanism
for "PSP refund succeeded, process crashed before `settle()` committed" is a CALLER retry of the same
logical refund using the SAME Phase A.5 `idempotencyKey`, which safely resumes (`reserve()` finds the
existing `pending` reservation, re-presents the same deterministic PSP key, and now — post this
phase's fix — settles exactly once even if that retry races a delayed original caller). If no caller
ever retries, the reservation stays `pending` indefinitely with no automated reconciliation. This is
architecturally consistent (no Stripe refund event is mapped to a kind at all — §4 item 9), not a
half-built mechanism, but it IS asymmetric with Capture's now-fully-automatic recovery. Documented as
a residual risk (§17), not fixed: building it would mean introducing a new `RefundSettlementPort`
capability and a `charge.refunded`→kind mapping — real scope expansion with no demonstrated
production incident behind it, which the phase's constraints direct against.

## 10. Concurrency Findings

| Scenario                                                             | PSP calls               | DB writes (settle) | Notify calls                | Result                                                |
| -------------------------------------------------------------------- | ----------------------- | ------------------ | --------------------------- | ----------------------------------------------------- |
| 2 concurrent refunds, same idempotencyKey, 30ms PSP latency          | 1 real effect (dedup'd) | 1                  | 1 (post-fix; was 2 pre-fix) | `refund-duplicate-side-effects.test.ts`               |
| 2 concurrent refunds, different amounts, no key (Phase A.4 baseline) | 1                       | 1                  | —                           | `refund-concurrency.test.ts` Case 1, still green      |
| 2 concurrent captures                                                | 1 real effect           | 1                  | 1                           | `capture-concurrency.test.ts`, still green            |
| webhook + capture retry race                                         | 0 extra                 | 1 Charge           | 1 Finance                   | `capture-crash-recovery.test.ts` Task 11, still green |
| duplicate webhook ×3                                                 | 0 extra                 | 1 Charge           | 1 Finance                   | `capture-crash-recovery.test.ts` Task 12, still green |

Every concurrency-sensitive suite was re-run 3× (`refund-duplicate-side-effects.test.ts`,
`webhook-identifier-correlation.test.ts`, `refund-concurrency.test.ts`,
`capture-concurrency.test.ts`) — deterministic all 3 times (23/23 each run). All concurrency proofs
use the `PostgresLikePaymentIntentRepository` fake (round-trips through `PaymentIntentMapper`,
reproduces Postgres's `UPDATE ... WHERE id = ? AND version = ?` contract) — single-process,
in-memory, NOT a claim of distributed/multi-replica safety; that limitation is stated explicitly here
per the phase's own discipline requirement.

## 11. Transaction Boundary Findings

Refund: PSP call happens strictly between `reserve()`'s transaction committing and `settle()`'s
transaction opening (`payment-lifecycle.use-cases.ts:452-486`) — confirmed unchanged from Phase A.4,
re-verified by reading, no open-transaction PSP call found. Capture: same shape, established Phase
A.8, unchanged. No new transaction-boundary risk introduced by this phase's fixes (the
`findByPspReference` fallback call and the `alreadySettled` check both execute INSIDE the existing
transaction boundaries — no new external call was added anywhere).

## 12. Schema/Migration Findings

`packages/db/prisma/schema/payments.prisma` gained one additive index:
`@@index([tenantId, pspReference])` on `PaymentIntent`, backing the new `findByPspReference` lookup.
`pnpm prisma validate` (run with a placeholder `DATABASE_URL`, since validation is schema-syntax-only
and does not require a live connection) passes: `The schemas at prisma\schema are valid`. `pnpm prisma
migrate status` fails identically to every prior phase — `Can't reach database server at
localhost:5432` — genuinely environment-blocked (no Docker/Postgres host in this sandbox), not
fabricated. No hand-written migration file exists in this checkout (confirmed: `packages/db/prisma/
migrations/**/*.sql` glob returns zero files) — consistent with Phase A.7's finding that this repo has
never run `prisma migrate dev` against a live database; the schema file is the only source of truth
available to audit.

## 13. Security Findings

- Webhook signature verification (`Stripe-Signature`, raw-byte HMAC, replay-tolerance) occurs before
  any repository call, PSP call, Finance call, or Notify call — unchanged by this phase, re-verified
  green (`payments-webhook.e2e.test.ts`, all 7 tests: invalid signature, tampered body, stale
  timestamp, missing header, missing tenant, malformed body all fail closed at 401/403/422 with zero
  downstream effect).
- Direct refund endpoint (`POST /payment-intents/:id/refund`) fail-closed behavior for
  missing/empty `Idempotency-Key`, tamper protection, cross-intent key scoping, and failed-key
  non-resurrection are all pre-existing (Phase A.6) and re-verified green — no regression from this
  phase's changes (`direct-refund-idempotency.e2e.test.ts`, 14/14 unchanged).
- `PaymentsAdminController.refund`/`.capture` (`apps/admin/src/interfaces/payments.admin-controller.ts:
55-62`, `:46-53`) delegate exclusively to `refundLifecycle`/`captureLifecycle` — confirmed by
  reading, not assumption. The legacy, unhardened `RefundPayment`/`CapturePayment`/`FailPayment` use
  cases (`refund-payment.use-case.ts` — synchronous `intent.refund()`, no PSP call, no idempotency)
  remain exported on `PaymentController` but are reachable from NO wired composition root in this
  repo (`apps/admin`, `apps/runtime`) — dead code from every actual HTTP/saga surface, not a live
  bypass. Documented, not removed (out of this phase's scope; no evidence removing it is safe without
  a broader sweep of anything that might still reference the exported class).
- Returns' `PrismaPaymentsPortAdapter`/`PrismaRefundVerificationAdapter` refund-capacity checks
  (Task 3 adjacent finding, §14) — fixed.

## 14. Exploit Tests

### Exploit 1 — Refund settlement duplicate side effects

- **Attack**: two callers present the same Phase A.5 idempotency key concurrently; both `reserve()`
  calls resolve before either `settle()` commits.
- **Pre-fix result**: 2 `notify` calls, 2 `refund.transitioned(completed)`-equivalent attempt-log
  entries, for one logical refund.
- **Root cause**: `RefundPaymentLifecycle.settle()` had no "already settled" guard (unlike Capture's
  Phase A.9 fix).
- **Remediation**: added an `alreadySettled` check mirroring Capture's `alreadyCaptured` pattern.
- **Post-fix result**: exactly 1 notify call, 1 attempt-log entry, verified 3× for determinism.

### Exploit 2 — Stripe webhook identifier mismatch

- **Attack**: a webhook carrying Stripe's own PaymentIntent id (`pi_...`), exactly as
  `payments-webhook-routes.ts` sends it.
- **Pre-fix result**: `RecordWebhook` returns `NOT_FOUND` for every such webhook — a real Stripe
  webhook could never reconcile against its intent.
- **Root cause**: `RecordWebhook` looked up exclusively by `findById` (domain id); the PSP's own
  reference is stored separately as `pspReference`, with no lookup method.
- **Remediation**: added `findByPspReference` to the repository port (Prisma + in-memory), wired as a
  fallback in `RecordWebhook`, with the resolved domain id threaded through to `captureSettlement.
settle()` and the response.
- **Post-fix result**: correlates correctly; unknown references still fail closed (404, no mutation);
  callers already using the domain id are unaffected; duplicate delivery via the PSP reference is
  idempotent.

### Exploit 3 — Refund-capacity miscount in Returns' Prisma adapters (found during Task 3/20 sweep)

- **Attack**: an order has one `failed` refund attempt, then a legitimate refund request for an
  amount that requires that failed amount to be excluded from "already refunded."
- **Pre-fix result**: `PrismaPaymentsPortAdapter.requestRefund` throws "no payment intent... has
  sufficient remaining amount"; `PrismaRefundVerificationAdapter.isRefundable` returns `false` — both
  wrongly, since the domain's own `PaymentIntent.remaining()` already excludes `failed` refunds.
- **Root cause**: both adapters summed `intent.refunds` unconditionally, never checking `status`.
- **Remediation**: both now filter `refund.status !== "failed"` before summing, matching the domain
  invariant exactly.
- **Post-fix result**: both adapters correctly report full capacity when the only prior refund
  attempt failed. Never an over-refund risk either way (the domain's own check is authoritative) —
  this was a false-rejection bug, now closed.

## 15. Regression Tests

- `services/payments/src/refund-duplicate-side-effects.test.ts` — **3 new tests** (Exploit 1).
- `services/payments/src/webhook-identifier-correlation.test.ts` — **4 new tests** (Exploit 2).
- `apps/runtime/src/composition.test.ts` — **2 new tests** (Exploit 3).
- Updated (interface-conformance only, no behavior change) to add `findByPspReference`:
  `refund-idempotency.test.ts`, `refund-concurrency.test.ts`, `capture-crash-recovery.test.ts`,
  `capture-concurrency.test.ts`.
- **Total new tests this phase: 9.** All pass; all were confirmed to fail against the pre-fix code via
  isolated temporary reverts before being confirmed green against the fix.

## 16. Quality Gates

| Gate                                                                                                                                                                                                                                | Result                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (via `turbo run typecheck --concurrency=1`, required — default parallel run crashed the Windows Node host with SIGABRT/exit 134 in unrelated packages, same class of flakiness prior phases documented for `test`) | **78/78 successful**                                                                                                                         |
| `pnpm test` (via `turbo run test --concurrency=1`)                                                                                                                                                                                  | **78/78 successful** (168 tests in `apps/runtime` alone, 123 in `apps/admin`, 70 in `services/payments`)                                     |
| `pnpm lint` (via `turbo run lint --concurrency=1`)                                                                                                                                                                                  | **78/78 successful**                                                                                                                         |
| `pnpm arch`                                                                                                                                                                                                                         | **0 violations, 1565 modules, 6788 dependencies cruised**                                                                                    |
| `pnpm prisma validate` (placeholder `DATABASE_URL`; schema-syntax-only)                                                                                                                                                             | **valid**                                                                                                                                    |
| `pnpm prisma migrate status`                                                                                                                                                                                                        | **environment-blocked** — `Can't reach database server at localhost:5432`, no Docker/Postgres host available, identical to every prior phase |
| `pnpm governance`                                                                                                                                                                                                                   | **does not exist in this checkout** (re-confirmed)                                                                                           |
| `pnpm dup`                                                                                                                                                                                                                          | **does not exist in this checkout** (re-confirmed)                                                                                           |

## 17. Remaining Risks

- **No webhook-driven refund reconciliation** (§9, §4 item 9): a refund whose PSP call succeeds but
  whose local `settle()` never runs (crash) has no automated recovery path — only a caller retry with
  the same idempotency key. Evidence-backed, not fixed (would require a new capability + event
  mapping with no demonstrated production incident behind it).
- **Refund events never reach Finance** (§4 item 5): `RefundPaymentLifecycle.settle()` never calls
  `FinancePort.recordPaymentEvent`, unlike Capture. Pre-existing, not introduced by this phase, not a
  duplication risk (nothing to duplicate) — but a real completeness gap for anyone relying on Finance
  to see refund events.
- **Legacy unhardened use cases still exported** (§13): `RefundPayment`/`CapturePayment`/`FailPayment`
  remain on `PaymentController`, reachable by nothing in this repo's wired composition roots today,
  but a latent risk if a future caller instantiates them directly instead of the `*Lifecycle`
  variants.
- **No live Postgres/Stripe verification possible in this sandbox** — every proof in this report is
  either a code citation or a single-process in-memory/fake-repository test; distributed-systems
  safety claims are explicitly NOT made anywhere above.
- **Permissive RBAC on `payments:refund`/`payments:capture`** (pre-existing, documented by Phase A.6's
  own Task 14 finding, re-confirmed unchanged this phase): any principal holding the blanket
  permission can act on any payment intent, no object-level ownership check.

## 18. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY**

Both headline risks this phase existed to resolve are now closed with evidence and regression
coverage: refund settlement is proven idempotent under concurrency, and the Stripe webhook
identifier-correlation defect — which would have made real Stripe webhooks silently unable to
reconcile in production — is fixed. A third related defect (refund-capacity miscount) was found and
closed in the same pass. All quality gates that exist in this repository are green. The verdict is
"conditionally" rather than unconditionally ready for the same standing reason as every prior Lumo
phase: no live Postgres or live Stripe run was possible in this sandbox, so distributed-systems safety
rests on a single-process optimistic-lock-faithful fake, not a real multi-replica database. The
remaining risks in §17 are real but bounded and explicitly documented, not silently left out.

## 19. Changed Files

- `services/payments/src/application/payment-lifecycle.use-cases.ts` — `RefundPaymentLifecycle.
settle()` idempotency guard (Exploit 1 fix).
- `services/payments/src/application/record-webhook.use-case.ts` — `findByPspReference` fallback +
  resolved-domain-id threading (Exploit 2 fix).
- `services/payments/src/domain/payment-intent-repository.ts` — new `findByPspReference` port method.
- `services/payments/src/infrastructure/prisma-payment-intent-repository.ts` — `findByPspReference`
  Prisma implementation.
- `services/payments/src/infrastructure/in-memory-payment-intent-repository.ts` —
  `findByPspReference` in-memory implementation.
- `packages/db/prisma/schema/payments.prisma` — additive `@@index([tenantId, pspReference])`.
- `apps/runtime/src/composition.ts` — `PrismaPaymentsPortAdapter`/`PrismaRefundVerificationAdapter`
  exclude `failed` refunds from capacity sums (Exploit 3 fix).
- `services/payments/src/refund-duplicate-side-effects.test.ts` — **new**, Exploit 1 regression (3
  tests).
- `services/payments/src/webhook-identifier-correlation.test.ts` — **new**, Exploit 2 regression (4
  tests).
- `apps/runtime/src/composition.test.ts` — Exploit 3 regression (2 new tests) + `FakeRefund.status`
  fixture field.
- `services/payments/src/refund-idempotency.test.ts`,
  `services/payments/src/refund-concurrency.test.ts`,
  `services/payments/src/capture-crash-recovery.test.ts`,
  `services/payments/src/capture-concurrency.test.ts` — added `findByPspReference` to each file's
  local `PostgresLikePaymentIntentRepository` fake (interface-conformance only; no test behavior
  changed).

## 20. Unchanged Areas

Orders, Customer Profile, Tracking Platform, Session Engine — not touched. `PaymentIntent`'s
transition table, all domain event contracts (`payment.captured`/`refunded`/`failed`,
`refund.transitioned`, `payment.webhook_received`), the reserve/PSP-call/settle architecture itself,
`ProcessedWebhookStore`'s dedup mechanism, Stripe signature verification, the direct refund endpoint's
Phase A.6 Idempotency-Key contract, and every existing public HTTP route shape — all unchanged. No
existing test was deleted or weakened to make this phase's suite pass.
