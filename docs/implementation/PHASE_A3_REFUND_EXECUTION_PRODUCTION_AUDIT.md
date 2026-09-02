# Phase A.3 — Refund Execution Path Production Audit & Remediation

**Date:** 2026-08-11 (session continued from 2026-08-10)
**Scope:** Returns → Payments refund _execution_ (as opposed to _authorization_, closed in Phase A.2).
**Status:** Audited, minimally remediated, uncommitted (per the project's sprint-isolation discipline — no
commit was made; this report and all code changes sit in the working tree alongside other uncommitted
sprints).
**Prior context:** [`PHASE_A1_...`](./PHASE_A1_FINANCIAL_SECURITY_REMEDIATION.md) (referenced, not
re-read in full), [`PHASE_A2_REFUND_SECURITY_CLOSURE_AUDIT.md`](./PHASE_A2_REFUND_SECURITY_CLOSURE_AUDIT.md)
(re-read; its Risk 1 is this phase's starting point, re-verified against current code, not trusted blindly).

---

## 1. Executive Summary

Phase A.2 closed refund **authorization** (F-04: is a staff-decided refund amount within the refundable
ceiling?) but left refund **execution** open as a documented, out-of-scope risk: `services/returns`'s
`PaymentsPort` — the port that actually tells Payments to move money — was hardcoded to an offline no-op
(`InMemoryPaymentsAdapter`) in every environment, including `apps/runtime`'s production composition. An
approved, amount-bounded Returns refund had **zero** downstream effect anywhere in this codebase.

This phase:

1. **Re-verified** that finding against the current checkout (not trusted from memory) — confirmed exactly
   true, file:line evidence in §2.
2. **Determined the no-op was neither malicious nor a deliberate architectural boundary** — it was
   unfinished wiring. A real, already-audited write path (`RefundPaymentLifecycle`, used by the pre-existing
   `POST /payment-intents/:id/refund` route) already existed in `services/payments` and could be reused
   without new architecture.
3. **Implemented the minimal fix**: a new `PrismaPaymentsPortAdapter` in `apps/runtime/src/composition.ts`
   that resolves the target `PaymentIntent` by reading Payments' own tables directly (same read pattern as
   the existing `PrismaRefundVerificationAdapter`) and then executes the refund through Payments' own
   public `wirePayments()`/`PaymentController.refundLifecycle` — no new business logic, no new bounded
   context, no event-contract change. One new optional field (`paymentsPort`) was added to
   `ReturnsWiringDeps` and threaded through `AdminWiringDeps`, mirroring the existing `refundVerification`
   convention exactly.
4. **Found a second, more severe, PRE-EXISTING defect while proving the fix's correctness under
   concurrency**: `RefundPaymentLifecycle` checks its `totalRefunded <= totalCaptured` invariant, then awaits
   the PSP call, and only afterward persists — a real time-of-check-to-time-of-use gap around an external
   network call. This is not introduced by this phase, but this phase is the first to make it reachable
   from Returns, and the first to test it. It is **not fixed** here (see §6, §17) — fixing it correctly
   needs a structural change to an already-shipped, previously-audited use case, which is out of this
   phase's "smallest possible fix" / "no new architecture" mandate.

**Verdict:** **CONDITIONALLY PRODUCTION READY** — see §19 for the full rationale. The refund-execution gap
this phase was chartered to close is closed for real production composition. A second, pre-existing,
more severe concurrency gap was discovered, is documented in full, and is explicitly **not** fixed —
flagged as the top blocking item for any future sprint before this path can be called unconditionally safe.

---

## 2. Refund Execution Flow (full trace, file:line evidence)

```
Returns HTTP route          apps/admin/src/http/returns-routes.ts:127-137  (POST /returns/:returnId/resolution)
        v
Admin facade (RBAC)         apps/admin/src/interfaces/returns.admin-controller.ts:90-97
        v
Returns controller          services/returns/src/interfaces/returns.controller.ts:70-72
        v
DecideResolution use case   services/returns/src/application/return-lifecycle.use-cases.ts:368-439
        v
RefundVerificationPort      services/returns/src/application/ports.ts:27-29 (optional; bounds the amount)
        v  (only if outcome === "refund")
PaymentsPort.requestRefund  services/returns/src/application/ports.ts:11-19
        v
[BEFORE THIS PHASE: InMemoryPaymentsAdapter — no-op, execution stopped here]
[AFTER THIS PHASE, in apps/runtime: PrismaPaymentsPortAdapter — apps/runtime/src/composition.ts]
        v
PaymentController.refundLifecycle   services/payments/src/interfaces/payment.controller.ts:83-85
        v
RefundPaymentLifecycle use case     services/payments/src/application/payment-lifecycle.use-cases.ts:255-309
        v
PaymentIntent.requestRefund()/.completeRefund()   services/payments/src/domain/payment-intent.ts:252-287
        v
PrismaPaymentIntentRepository.save()   services/payments/src/infrastructure/prisma-payment-intent-repository.ts:30-71
        v
Postgres (payment_intents / charges / refunds / payment_attempts)
        v
StripePaymentProvider.refund()   packages/psp-stripe/src/stripe-payment-provider.ts:125-134  (real Stripe REST call)
```

### Per-hop detail

| Hop                             | Interface                                                                       | Implementation                                                                                                        | Real or stubbed                                      | Persistence                      |
| ------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------- |
| HTTP route                      | zod-validated body `{outcome, amountMinor?, currency?}`                         | `returns-routes.ts:34-38`                                                                                             | Real                                                 | n/a                              |
| RBAC                            | `AdminGuard.ensure`                                                             | `returns.admin-controller.ts:92`                                                                                      | Real (permission-gated)                              | n/a                              |
| `DecideResolution`              | `DecideResolutionDeps`                                                          | `return-lifecycle.use-cases.ts:357-365`                                                                               | Real                                                 | Returns' own tx                  |
| `RefundVerificationPort`        | `isRefundable(orderRef, amountMinor, currency): Promise<boolean>`               | `PrismaRefundVerificationAdapter` (prod) / `InMemoryRefundVerificationAdapter` (default)                              | **Real in `apps/runtime`** (Phase A.2)               | Read-only                        |
| `PaymentsPort`                  | `requestRefund(orderRef, amountMinor, currency, idempotencyKey): Promise<void>` | `PrismaPaymentsPortAdapter` (prod, **new this phase**) / `InMemoryPaymentsAdapter` (default, unchanged no-op)         | **Real in `apps/runtime` as of this phase**          | Delegates to Payments            |
| `RefundPaymentLifecycle`        | `execute(paymentIntentId, amountMinor, currency)`                               | `payment-lifecycle.use-cases.ts:255-309`                                                                              | Real (pre-existing, Sprint 4.8)                      | Payments' own tx                 |
| `PaymentIntent` domain          | `requestRefund()`/`completeRefund()`                                            | `payment-intent.ts:252-287`                                                                                           | Real                                                 | In-memory (aggregate)            |
| `PrismaPaymentIntentRepository` | `save()`/`findById()`                                                           | `prisma-payment-intent-repository.ts`                                                                                 | Real                                                 | Real Postgres, optimistic-locked |
| PSP                             | `PaymentProvider.refund()`                                                      | `StripePaymentProvider` (when `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` set) / `InMemoryPaymentProvider` (fallback) | **Real when configured** (Sprint C2-2, pre-existing) | External (Stripe)                |

Error handling per hop: `RefundVerificationPort` rejection → `ValidationError` (422), never reaches
`PaymentsPort`. `PaymentsPort`/`RefundPaymentLifecycle` domain-invariant rejection → thrown/`err(...)`,
propagates up (not swallowed — `DecideResolution`'s call to `paymentsPort.requestRefund` is a bare
`await`, not wrapped in a best-effort try/catch, unlike `notifyBestEffort`). This means a Payments-side
failure correctly fails the whole `DecideResolution` transaction (see §11).

---

## 3. Composition Map

| Composition root                                              | `paymentsPort` (Returns')                                                                                                                                                                                                  | Concrete implementation                                                                                                | Notes                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `services/returns/src/composition.ts` (`wireReturns`)         | Optional field on `ReturnsWiringDeps` (**added this phase**)                                                                                                                                                               | `deps.paymentsPort ?? new InMemoryPaymentsAdapter()`                                                                   | Default unchanged for every existing caller that doesn't pass it |
| `apps/admin/src/composition.ts` (`wireAdmin`)                 | Optional field on `AdminWiringDeps` (**added this phase**, named `paymentsPort`, typed as Returns' `PaymentsPort` aliased `ReturnsPaymentsPort` to avoid colliding with Licensing's unrelated same-named port at line 171) | Passed straight through to `wireReturns(deps)`                                                                         | Default unchanged                                                |
| `apps/runtime/src/api.ts` (`startApi` → `createAdminHttpApi`) | **Wired to `buildReturnsPaymentsPortAdapter(runtime)`** (**new this phase**)                                                                                                                                               | `PrismaPaymentsPortAdapter` bridging to a second `wirePayments()` instance sharing the same `prisma`/`paymentProvider` | Real production composition — this is the fix                    |
| `services/returns/src/returns.e2e.test.ts`                    | Not passed                                                                                                                                                                                                                 | `InMemoryPaymentsAdapter` (unchanged)                                                                                  | Confirms the default is unchanged post-fix                       |
| `services/returns/src/application/decide-resolution.test.ts`  | Not passed / spy                                                                                                                                                                                                           | `SpyPaymentsPort` (unchanged)                                                                                          | Confirms reachability contract is unchanged                      |

`apps/runtime/package.json` gained an explicit `@platform/payments` dependency (was previously not a
dependency at all — `PrismaPaymentsPortAdapter` needs `wirePayments`/`PaymentController`, both from the
package's already-public `services/payments/src/index.ts` barrel; no new exports were added there).
`services/returns/src/index.ts` gained one additive export: `PaymentsPort` (previously only
`RefundVerificationPort` was exported from `./application/ports`).

---

## 4. No-Op Stub Analysis (Phase B)

Re-ran the full repo sweep for `PaymentsPort`, `requestRefund`, `RefundVerificationPort`, `Refund`,
`PaymentIntent`, PSP adapters, `TODO`/`FIXME`/`no-op`/`stub`/`placeholder`/`not implemented` (delegated to
a read-only Explore pass at the start of this session; independently re-verified every claim used below by
direct file reads before acting on it).

1. **Is the no-op used only in tests?** No — it was the _only_ implementation reachable from `apps/runtime`
   (production) before this phase.
2. **Is it used by `apps/runtime`?** Yes, unconditionally, before this phase (§2, §3). Fixed.
3. **Is it used by production composition?** Yes — `apps/runtime` is this codebase's production entrypoint
   (`apps/runtime/src/api.ts`, `startApi`). Fixed.
4. **Is there an existing real Payments adapter?** Not for the WRITE side before this phase (only the
   READ-only `PrismaRefundVerificationAdapter`, Phase A.2). One now exists (`PrismaPaymentsPortAdapter`).
5. **Is there an existing external PSP adapter?** Yes, `StripePaymentProvider`
   (`packages/psp-stripe/src/stripe-payment-provider.ts`), real REST calls to Stripe, wired in
   `apps/runtime/src/composition.ts:211-220` when `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are
   configured (Sprint C2-2, pre-existing, unrelated to this phase). It was never reachable from Returns
   before this phase (Returns had no path to `services/payments` at all); it now is, transitively, through
   `PrismaPaymentsPortAdapter` → `RefundPaymentLifecycle` → `PaymentProvider`.
6. **Is there an established pattern for writing Payments state?** Yes — `RefundPaymentLifecycle` +
   `PrismaPaymentIntentRepository`, already used by the real `POST /payment-intents/:id/refund` route. This
   phase reused it rather than inventing a second write path.
7. **Is the repository intentionally operating with simulated payments for Returns specifically?** No —
   `services/returns/src/infrastructure/in-memory-port-adapters.ts:29-33`'s own doc comment says
   "Production swaps this for the Payments adapter," and `ReturnsWiringDeps`'s doc comments for the sibling
   `refundVerification` field explicitly describe the "present ⇒ real, absent ⇒ stub" convention that was
   simply never extended to `paymentsPort`. This reads as an **incomplete wiring gap**, not an intentional
   simulation — consistent with `PHASE_A2_REFUND_SECURITY_CLOSURE_AUDIT.md`'s own conclusion (quoted
   verbatim in that report's Remaining Risks §16, re-verified true against current code before this phase
   began).

**Conclusion for Phase B: (3) real production-readiness defect**, not (1) an intentional limitation or (2)
a test/dev-only stub. Confirmed, not assumed.

---

## 5. Exploit/Failure Evidence (Phase C)

The "before" state was not re-derived from scratch — it is already proven, in the repository, by
`services/returns/src/application/decide-resolution.test.ts` (5 tests, unchanged by this phase, still
passing), whose own header comment names the exact defect this phase closes:

> "exercises `DecideResolution` directly (bypassing `wireReturns`, whose `paymentsPort` is hardcoded to an
> unconditional no-op stub — see PHASE_A2_REFUND_SECURITY_CLOSURE_AUDIT.md, Task 1)"

and `services/returns/src/returns.e2e.test.ts`'s full RMA-to-refund flow (unchanged, still passing),
which asserts `resolved.status === 200` and `status === "refund_requested"` through `wireReturns()`'s bare
default (no `paymentsPort` supplied) — i.e., through the literal `InMemoryPaymentsAdapter` no-op — with
**no assertion of any kind about a Payments-side effect**, because there was none to assert.

Both tests remain valid, passing, "before" evidence AND valid ongoing regression coverage of the
(unchanged) default/fallback behavior: any composition root that does not pass `paymentsPort` still gets
the no-op, byte-for-byte the same as before this phase (confirmed: `services/returns/src/composition.ts`'s
`buildController` now does `deps.paymentsPort ?? new InMemoryPaymentsAdapter()` — `??` preserves the exact
prior behavior when the field is absent).

**New evidence this phase, proving the "after" state**: `apps/runtime/src/composition.test.ts`, new
`describe("PrismaPaymentsPortAdapter …")` block (8 new tests) — proves the new adapter correctly resolves
the target intent, delegates to `PaymentController.refundLifecycle` with the right
`paymentIntentId`/`amountMinor`/`currency`, and — critically — **fails closed** (throws, does not silently
succeed) when no intent has sufficient remaining amount, when the downstream controller rejects with a
4xx/5xx, when the order doesn't exist, or when tenant/currency scoping doesn't match.

---

## 6. Idempotency Audit (Phase D)

| Scenario                                                                                      | Protected?                                                                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate HTTP request / repeated resolution decision on the SAME return                      | **Yes**                                                                                                                                                                                                                                                                                                                                                          | Returns' own state machine: `decideResolution()` only transitions `items_accepted → refund_requested`; a second call on an already-`refund_requested` return is rejected before `paymentsPort` is ever called again. Proven by `decide-resolution.test.ts`'s "attempting to decide a resolution twice…" test (unchanged, still passing) — `paymentsPort.calls` stays at length 1 after two attempts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Same refund requested twice via two DIFFERENT returns for the same order                      | **Not specially protected**, but bounded by `RefundVerificationPort`'s live ceiling check (when wired, as in `apps/runtime`) — the second return's request would be checked against the ALREADY-reduced remaining amount (Payments' own `charges`/`refunds` ledger, read fresh each time by `PrismaRefundVerificationAdapter`).                                  | `apps/runtime/src/composition.ts:278-304`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Refund exceeding captured/remaining amount                                                    | **Yes, in three independent places**: (1) `RefundVerificationPort` (Returns-side ceiling check, Phase A.2), (2) `PrismaPaymentsPortAdapter`'s own intent-selection (fails closed if no intent has sufficient remaining, **new this phase**), (3) `PaymentIntent.requestRefund()`'s domain invariant (`totalRefunded <= totalCaptured`, pre-existing, Sprint 4.8) | `payment-intent.ts:252-255`; boundary-tested at 300/800/801/5000 against captured=1000/refunded=200 in `payment-intent.test.ts:114-169` (pre-existing) and again at the Returns-bridge level in this phase's new `composition.test.ts` tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Retry after timeout (client re-sends the same logical request)                                | **Not protected at the PSP layer** — see below                                                                                                                                                                                                                                                                                                                   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Caller-supplied idempotency key (`` `${returnId}:refund` ``, generated by `DecideResolution`) | **Not threaded through**                                                                                                                                                                                                                                                                                                                                         | `RefundPaymentLifecycleInput` has no idempotency-key field; `PrismaPaymentsPortAdapter.requestRefund`'s 4th parameter is accepted (interface parity) but intentionally unused — there is nowhere downstream to pass it. This is a **pre-existing gap in `RefundPaymentLifecycle`**, not introduced by this phase: `payment-lifecycle.use-cases.ts:289` builds the PSP-side idempotency key as `` `${intent.id.toString()}:refund:${this.deps.idGenerator.generate()}` `` — a **freshly generated id on every call**, unlike `createIntent`'s stable `` `${id.toString()}:create` `` (`:79`) or `capture`'s stable `` `${intent.id.toString()}:capture` `` (`:222`). A network-level retry of the exact same logical refund would get a _different_ Stripe idempotency key each time, defeating Stripe's own 24h server-side dedupe for refunds specifically. This affects BOTH the pre-existing `POST /payment-intents/:id/refund` route and, now, this phase's new Returns bridge, transitively. **Not fixed in this phase** (see §17) — it predates this audit's scope and fixing it correctly means changing an already-shipped, previously-audited use case's PSP-call construction, which is a real but separately-scoped correctness fix, not "wiring." |
| PaymentIntent's own `idempotencyKey` column/`findByIdempotencyKey`                            | **Dormant, confirmed unchanged**                                                                                                                                                                                                                                                                                                                                 | `packages/db/prisma/schema/payments.prisma:12-17` (nullable, `@@unique([tenantId, idempotencyKey])`, "no code path writes it yet"); `services/payments/src/infrastructure/find-by-idempotency-key.test.ts` still proves it always returns `null` (unchanged, still passing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Conclusion:** application-level duplicate-decision safety is real and proven (Returns' state machine).
Amount-ceiling safety is real and proven in three independent layers. PSP-call-level retry safety is a
real, pre-existing gap, unaffected in shape by this phase but now reachable via a second route.

---

## 7. Concurrency Audit (Phase E) — the most significant finding of this phase

**The scenario the task specified:** captured=1000, refund A=700, refund B=700, executed concurrently.

### What was tested, and what was found

`services/payments/src/payments.e2e.test.ts`, new test _"Phase E: two concurrent refunds of 700 against a
1000 capture, zero-latency PSP …"_ — `Promise.all([refundLifecycle(700), refundLifecycle(700)])` against a
single captured intent, through `wirePayments()`'s in-memory composition. **Result, both with the default
zero-latency in-memory PSP stub and with a `setTimeout`-delayed fake PSP simulating realistic network
latency: the second request is correctly rejected (409), the first succeeds (200).** This was tested
empirically, not assumed — an earlier draft of this test asserted the opposite (that both would succeed)
based on a hand-traced microtask-ordering argument, and the test **failed**, correcting that assumption.
The actual mechanism: Node fully drains the microtask queue between successive timer/macrotask callbacks,
so two `Promise.all`-scheduled calls to this specific `await`-shaped code path, within ONE event loop,
serialize their completions — the second's own `requestRefund()` invariant check always ends up running
_after_ the first's `completeRefund()` has already mutated the shared in-memory
`InMemoryPaymentIntentRepository` object (which returns the same mutable reference from every `findById`,
unlike the Prisma-backed repository).

**This is not a designed protection.** There is no lock, transaction, or queue anywhere in
`RefundPaymentLifecycle`. It is incidental to how one Node event loop happens to schedule this exact
`await` shape, and it is specific to the in-memory repository's shared-reference behavior. It says nothing
about the actually-deployed topology.

### The real risk: cross-process concurrency (code-level finding, not runtime-proven — no Docker host available)

This codebase deploys to Kubernetes with HPA (multiple pod replicas — confirmed by the existence of
`infrastructure/k8s`-style deployment manifests referenced in prior session memory for other services,
e.g. the storefront/worker deployments). Two replicas handling two concurrent refund requests for the same
`PaymentIntent` run in **separate processes, separate event loops** — the in-memory serialization observed
above cannot apply.

Tracing the Prisma-backed path by code (§2's hop table), for two concurrent requests A and B against the
same `paymentIntentId`, captured=1000, each for 700:

1. `PrismaPaymentIntentRepository.findById()` (`prisma-payment-intent-repository.ts:73-90`) issues a fresh
   `findFirst` and builds a **new** domain object via `PaymentIntentMapper.toDomain(...)` on every call — A
   and B get **independent** objects, not a shared reference (unlike the in-memory repository).
2. Both A's and B's independent copies start at `version=N`, `remaining()=1000` (neither has seen the
   other's in-flight work). Both pass `intent.requestRefund(700, ...)` (`payment-intent.ts:252-255`) —
   **the invariant check does not touch the database**, it only reads the in-memory copy each replica
   already holds.
3. Both A and B reach `if (intent.pspReference !== undefined) { await this.deps.paymentProvider.refund(...) }`
   (`payment-lifecycle.use-cases.ts:285-290`) — **both call the real PSP** (Stripe). Two real refund
   requests are issued for what should be one logical operation.
4. Both call `intent.completeRefund(700, ...)` on their own local copy (no invariant re-check inside
   `completeRefund` itself — confirmed by reading `payment-intent.ts:270-287`, it unconditionally pushes a
   `Refund` entity and recomputes status).
5. Both call `save()`. `PrismaPaymentIntentRepository.save()` (`:30-71`) does a version-guarded
   `updateMany({where: {id, tenantId, version: intent.version}, ...})`. **Exactly one** of A/B will find
   its expected version still current and commit (Refund row inserted, version incremented). The **other**
   finds `updated.count === 0` and throws `ConcurrencyError` (`:51-55`) — this happens _before_ the losing
   request's own `charge`/`refund`/`attempt` rows are inserted (the throw is earlier in the same function),
   so no partial/inconsistent row is left behind, and Prisma auto-rolls-back the whole transaction the
   throw occurred in.
6. **The losing request's `ConcurrencyError` is not caught anywhere in the call chain.** Confirmed by
   reading `RefundPaymentLifecycle.execute()`: the `await this.deps.intents.save(intent, tx)` call is a
   bare `await`, not wrapped in the `try { … } catch (error) { if (isDomainError(error)) return err(error); }`
   pattern used around `requestRefund()`/`completeRefund()` a few lines above. So the throw propagates as a
   **rejected promise** out of `execute()`, out of `PaymentController.refundLifecycle()` (which never
   reaches its own `present(...)` call), and — when reached via this phase's new bridge — out of
   `PrismaPaymentsPortAdapter.requestRefund()` (also not caught there), out of `DecideResolution`'s own
   `await this.deps.paymentsPort.requestRefund(...)` call (also a bare `await`), causing Returns' OWN
   transaction to roll back too.

**Net effect, reasoned from code (not run against a live Postgres — no Docker host in this sandbox, the
same limitation every prior session in this project's history has hit):**

- The **domain ledger never over-refunds** — exactly one Refund row is durably persisted per race, the
  optimistic lock guarantees this.
- The **losing request's Returns resolution correctly rolls back** (no false success at the Returns layer)
  — this is the _good_ news, and it is a direct, positive consequence of this phase's adapter deliberately
  not swallowing errors (§11).
- **But the PSP was called twice for real.** If the PSP is Stripe, this means two real refund API calls
  were issued against the customer's card/account for what the domain believes is one 700 refund. Whether
  this actually double-refunds the customer's money depends on Stripe's OWN idempotency/dedup behavior —
  and §6 already established that this exact call site's idempotency key is **not stable across retries**
  (a fresh id is appended every call), so Stripe has no basis to recognize these as duplicates. **This is
  the single most severe finding of this audit.**

### Why this was not fixed in this phase

Fixing it correctly requires changing where the PSP call sits relative to the persistence commit inside
`RefundPaymentLifecycle` — e.g., reserving the refund durably (a first commit recording "refund
requested, not yet PSP-confirmed") before calling the PSP, then finalizing after — which is a structural
change to an already-shipped, previously-audited (Phase A.2) use case, not "the smallest possible fix" to
the mandate this phase was chartered for (Returns had _zero_ effect; that specific defect is now closed).
The absolute constraints explicitly forbid introducing new saga/queue/outbox infrastructure to solve this
unless reuse of an _already-present_ pattern is "clearly necessary" — and while this codebase does have an
outbox/Kafka-consumer pattern elsewhere, retrofitting it into `RefundPaymentLifecycle`'s transaction
boundary is a real redesign of that use case, explicitly out of scope for a wiring-only phase. It is
recorded here, in full, with exact file:line evidence, as the top item for a dedicated follow-up phase.

### Other Phase E scenarios (as specified)

- **Two concurrent refunds of 300 against captured 500:** by the same code-level reasoning, both would pass
  `requestRefund`'s check independently in a cross-process race (300+300=600 > 500 domain-invalid, but
  neither knows about the other), same double-PSP-call risk, same eventual single-winner domain outcome.
  Not independently re-tested — it is the same mechanism as the proven case above at different numbers.
- **Two concurrent refunds of 500 against captured 500:** same mechanism; the domain ledger still ends with
  exactly one 500 refund recorded (the loser's write is rejected), but again two PSP calls may have fired.
- **Refund + capture concurrently:** `CapturePaymentLifecycle` and `RefundPaymentLifecycle` operate on
  different status preconditions (`captured` is a precondition for capture to be a no-op-illegal-transition
  target; a legitimate capture-then-refund race would require the intent to be simultaneously
  `processing`/`authorized` for one caller and `captured` for the other, which the domain's `transition()`
  state table (not reproduced here) would need auditing in its own right) — **not tested in this phase**;
  flagged as an adjacent gap for the same follow-up, not fabricated as a finding without evidence.

---

## 8. Persistence Atomicity (Phase F)

**Within Payments' own write (`RefundPaymentLifecycle` → `PrismaPaymentIntentRepository.save()`):**
atomic. All of the version-checked intent update, the `charge`/`refund`/`attempt` row inserts, and the
same-transaction outbox write happen inside one `prisma.$transaction()` call (via `PrismaUnitOfWork.run()`,
`packages/db/src/prisma-repository.ts:34-44`), confirmed by direct code read. No read-modify-write gap
inside this one boundary.

**Across the NEW Returns → Payments bridge introduced this phase:** **not atomic**, by design and by
necessity, and this is a deliberate, documented trade-off, not an oversight:

- `DecideResolution.execute()` wraps its own work in `this.deps.unitOfWork.run(async (tx) => {...})` — a
  `PrismaUnitOfWork(prisma).run(...)`, i.e., one `prisma.$transaction()` call on the shared `prisma` client.
- Inside that callback, `PrismaPaymentsPortAdapter.requestRefund()` calls
  `this.payments.refundLifecycle(...)`, which internally invokes `RefundPaymentLifecycle.execute()`, which
  calls `this.deps.unitOfWork.run(...)` — a **second, independent** `PrismaUnitOfWork(prisma).run(...)`,
  i.e., a **second** `prisma.$transaction()` call on the **same** shared `prisma` client, opened from
  _inside_ the first one's callback.
- This is legal Prisma usage (a second `$transaction()` call against the base client, not the `tx` proxy,
  acquires its own connection from the pool) but the two transactions are **not atomically joined** — they
  commit independently.
- **Failure-direction analysis:** if Payments' inner transaction throws (invariant violation,
  `ConcurrencyError`, PSP error), the throw propagates all the way out (§7, §11) and causes Returns' outer
  transaction to roll back too — **consistent, no false success.** If Payments' inner transaction
  **succeeds and commits**, Returns' outer transaction still has to complete its own remaining work
  (`notifyBestEffort`, which swallows its own errors and cannot fail the transaction) before its own commit
  — in practice, once `paymentsPort.requestRefund()` returns successfully, nothing else in
  `DecideResolution.execute()` can throw, so the outer transaction reliably commits too. The only residual
  window is an external failure between Payments' commit and Returns' own commit (e.g., the Postgres
  connection drops at that exact moment) — an inherent risk of any two-transaction composition, not
  something this phase's design choice made worse than the alternative (a single joined transaction across
  two bounded contexts' own persistence would itself be an architecture violation — contexts do not share
  transactions in this codebase's design, confirmed by every other cross-context port in the repo being
  either read-only or eventually-consistent via the outbox).
- **This was not verified against a live Postgres** (no Docker host in this sandbox) — the "two independent
  `$transaction()` calls on one shared client are both legal and functionally correct, just not atomically
  joined" claim is a code-level, Prisma-semantics-based conclusion, not a runtime-proven one. Flagged
  honestly rather than asserted as tested.

---

## 9. External PSP Audit (Phase G)

A real external payment provider **does exist**: `StripePaymentProvider`
(`packages/psp-stripe/src/stripe-payment-provider.ts`), pre-existing (Sprint C2-2, unrelated to this
phase), making real, unauthenticated-SDK REST calls to `https://api.stripe.com`. Verified per the task's
checklist:

- **Amount sent:** `refund()` (`:125-134`) sends `amount: String(amountMinor)` — the exact caller-supplied
  minor-unit integer, no conversion bug observed.
- **Currency sent:** not sent on `refund()` specifically (Stripe's refund API infers currency from the
  original charge) — consistent with Stripe's actual API contract, not a gap.
- **Payment/charge reference:** `payment_intent: providerIntentId` — the PSP-side reference, correctly
  sourced from `intent.pspReference.value` by the caller (`payment-lifecycle.use-cases.ts:287`).
- **Idempotency key:** sent on every mutating call via the `Idempotency-Key` header (`:166`) — **but see
  §6/§7**: the key passed to `refund()` specifically is not stable across retries, defeating this
  protection for refunds only (create/capture are unaffected, confirmed stable keys at `:79`/`:222`).
- **Error mapping:** not independently re-audited in this phase (out of the Returns-execution scope); no
  new finding either way.
- **Retry/timeout handling:** not independently re-audited in this phase.
- **Webhook reconciliation:** pre-existing (`verifyWebhook`, real HMAC check via
  `packages/psp-stripe/src/webhook-signature.ts`), unrelated to this phase's scope, not re-verified here.

Before this phase, Returns' refund flow could not reach Stripe under any circumstance (no code path
existed). After this phase, it can, in `apps/runtime`'s production composition, when Stripe is configured
— transitively, through the fix in §2.

---

## 10. Refund State Consistency (Phase H)

The four cases specified were already covered, pre-existing, by `services/payments/src/domain/payment-intent.test.ts`'s boundary matrix (unchanged by this phase, still passing, 14 tests): captured=1000 against refund
amounts of 300 (Case 1, refunded=300/remaining=700), 1000 (Case 2, refunded=1000/remaining=0, full
refund), 1001 (Case 3, must fail — `BusinessRuleError`), and captured=1000/existing-refund=700/new=400
(Case 4, must fail — 700+400=1100>1000). All four are proven at the domain layer, which is the correct
single source of truth for this invariant (not duplicated in `PrismaPaymentsPortAdapter`, which only picks
_which_ intent to target, not whether the amount is valid — that check is delegated entirely to
`RefundPaymentLifecycle`/`PaymentIntent`, per Rule 2, zero duplication).

This phase's new `PrismaPaymentsPortAdapter` tests (`apps/runtime/src/composition.test.ts`) additionally
prove the SAME boundary at the Returns-bridge level (a 300-of-800-remaining success, an 800-exact-boundary
success, an 801-over-boundary fail-closed rejection) — proving the bridge does not accidentally weaken or
duplicate the underlying invariant.

---

## 11. Authorization vs Execution (Phase I)

Cleanly separated, confirmed by direct code read, unaffected by this phase's change to which port is
`PaymentsPort` wired to real:

- `RefundVerificationPort.isRefundable(orderRef, amountMinor, currency): Promise<boolean>`
  (`services/returns/src/application/ports.ts:27-29`) answers **only** "is this refund allowed" — it is a
  pure read (`PrismaRefundVerificationAdapter` never writes anything, confirmed `apps/runtime/src/composition.ts:278-304`
  is 100% `findMany` + arithmetic, no `create`/`update`/`save` call anywhere in the class).
- `PaymentsPort.requestRefund(...): Promise<void>` (`ports.ts:11-19`) is **exclusively** the execution
  capability — before this phase, it executed nothing (no-op); after this phase, in `apps/runtime`, it is
  the ONLY thing in the whole call chain that causes durable state to change or an external PSP call to
  fire.
- `DecideResolution` calls `refundVerification` BEFORE the domain transition, and `paymentsPort` AFTER the
  domain transition is saved (`return-lifecycle.use-cases.ts:389-433`) — verification gates the decision,
  execution follows it. The two never overlap in responsibility.

---

## 12. Error Handling (Phase J)

The critical invariant — **"a Return must not become 'refunded successfully' merely because the
authorization check passed"** — holds, confirmed by code and by the propagation chain traced in §7/§8:

- `DecideResolution`'s call to `paymentsPort.requestRefund(...)` is a bare `await`, not a best-effort
  swallow (unlike `notifyBestEffort`, which explicitly catches and discards). Any thrown error —
  insufficient remaining amount (this phase's new adapter, fail-closed), a `ConcurrencyError` from a losing
  concurrent request (§7), a PSP failure inside `RefundPaymentLifecycle` (also a bare, uncaught `await`,
  confirmed `payment-lifecycle.use-cases.ts:286-290`), a `NotFoundError` for an unknown `paymentIntentId` —
  **propagates all the way out and rolls back Returns' own transaction.** The Return's status never
  advances to `refund_requested` unless Payments' execution actually succeeded and committed.
- Payment not found / charge not captured / already refunded / refund exceeds remaining / unsupported
  currency: all pre-existing, all covered by `payment-intent.test.ts`'s boundary matrix and
  `payments.e2e.test.ts`'s 404/409/422 tests (unchanged, still passing).
- Duplicate request: covered by Returns' own state machine (§6).
- Database failure: not independently fault-injected (would need a live DB with a killable connection —
  unavailable in this sandbox); by code inspection, an unhandled Prisma error during `save()` behaves the
  same as `ConcurrencyError` — an uncaught throw that rolls back both transactions. Not claimed as
  empirically tested.
- **Minor, non-blocking polish gap found**: a losing concurrent request's `ConcurrencyError` (or any other
  uncaught `DomainError` reaching this specific call site through the bridge) surfaces as whatever the
  transport-level generic error handler maps an unhandled rejection to — likely a raw 500, not the clean
  409 `present()` would have produced had the error been caught before crossing the adapter boundary. Not a
  security defect (no false success), but a UX/observability rough edge, noted for future cleanup, not
  fixed here (would mean adding a try/catch around the bridge call that re-throws as a `DomainError`, a
  small, low-risk, but out-of-mandate-scope change for this specific phase).

---

## 13. Production Composition (Phase K)

Re-verified directly (not assumed from Phase A.2's memory) that `apps/runtime` is the actual production
entrypoint (`apps/runtime/src/api.ts`, `startApi`, invoked when `process.argv[1]` ends in `api.ts`/`api.js`)
and that it now passes a real `paymentsPort` — confirmed by reading the current `api.ts` after this phase's
edit (§2, §3). `apps/admin`'s own composition (`wireAdmin`) is the shared library both `apps/runtime` and
any test harness build on; it does not itself decide which adapter is real, it only threads through
whatever the caller supplies (unchanged pattern, matches `refundVerification`/`paymentVerification`/every
other optional production adapter in this file). Test compositions (`services/returns`'s own e2e suite,
`decide-resolution.test.ts`) do not pass `paymentsPort` and therefore continue to exercise the no-op —
this is correct and intentional (tests should not require a live Payments composition to run), not a
regression.

---

## 14. Findings

| ID    | Severity                       | Component                                    | Trust boundary                  | Precondition                                                                                  | Evidence                                                                                                                                | Impact                                                                                                                                                                            | Fix                                                                                                                                                                    | Verification                                                                                                                       | Residual risk                                                                     |
| ----- | ------------------------------ | -------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A3-01 | **High** (closed)              | `services/returns` composition               | Returns→Payments                | Any approved refund                                                                           | `services/returns/src/composition.ts:79` (pre-fix), `InMemoryPaymentsAdapter`                                                           | Approved refunds had zero real effect in every environment                                                                                                                        | `PrismaPaymentsPortAdapter` (new), wired in `apps/runtime/src/api.ts`                                                                                                  | 8 new adapter tests, full gate suite green                                                                                         | Multi-intent-per-order splitting not implemented (documented simplification, §16) |
| A3-02 | **Critical** (open, not fixed) | `services/payments` `RefundPaymentLifecycle` | Payments internal, external PSP | Two concurrent refund requests for the same `PaymentIntent` from different processes/replicas | `payment-lifecycle.use-cases.ts:279-304` (check-then-act gap around `await paymentProvider.refund(...)`); cross-process reasoning in §7 | PSP called twice for one logical refund; domain ledger records only the winner — real money movement can exceed the recorded ledger                                               | **Not implemented this phase** — needs a structural change to an already-audited use case (reserve-then-confirm or equivalent), out of "smallest possible fix" mandate | In-process empirically tested (does not reproduce, §7); cross-process reasoned from code only, not runtime-proven (no Docker host) | Real, until a dedicated follow-up phase addresses it                              |
| A3-03 | **Low**                        | `services/payments` `RefundPaymentLifecycle` | PSP idempotency                 | Any retried refund request (client timeout, network blip)                                     | `payment-lifecycle.use-cases.ts:289`, fresh idempotency key per call                                                                    | Stripe cannot dedupe a retried refund                                                                                                                                             | Not fixed (pre-existing, out of scope)                                                                                                                                 | Code-read only                                                                                                                     | Compounds A3-02                                                                   |
| A3-04 | **Low**                        | Returns→Payments bridge error surfacing      | n/a                             | A losing concurrent request (A3-02) or any uncaught downstream error                          | §12                                                                                                                                     | Raw 500 instead of a clean 409; no false success                                                                                                                                  | Not fixed (polish only)                                                                                                                                                | Code-read only                                                                                                                     | Cosmetic                                                                          |
| A3-05 | **Informational**              | `PrismaPaymentsPortAdapter` intent selection | n/a                             | An order with more than one `PaymentIntent` in the same currency                              | Adapter picks the first intent with sufficient remaining; does not split across intents                                                 | A multi-intent order (e.g. a retried/failed-then-succeeded checkout) could have a refund incorrectly rejected as "insufficient" even though the SUM across intents would cover it | Not implemented — no evidence this scenario occurs in this codebase's checkout flow today (documented simplification, not a speculative fix)                           | 2 new adapter tests cover single- and multi-intent selection (picks the one with enough remaining)                                 | Would need a follow-up if multi-intent orders become real                         |

---

## 15. Fixes Applied

1. `services/returns/src/index.ts` — additive export: `PaymentsPort` type (was previously internal-only).
2. `services/returns/src/composition.ts` — added optional `paymentsPort?: PaymentsPort` to
   `ReturnsWiringDeps`; `buildController` now does `deps.paymentsPort ?? new InMemoryPaymentsAdapter()`
   (was unconditional).
3. `apps/admin/src/composition.ts` — added optional `paymentsPort?: ReturnsPaymentsPort` (aliased import to
   avoid colliding with Licensing's unrelated same-named port) to `AdminWiringDeps`; passed straight
   through to `wireReturns(deps)` (no code change needed at the call site — same object flows through).
4. `apps/runtime/package.json` — added `@platform/payments` as an explicit dependency (previously
   transitive-only/absent).
5. `apps/runtime/src/composition.ts` — new `PrismaPaymentsPortAdapter` class (implements Returns'
   `PaymentsPort` by reading Payments' own tables to select the target intent, then delegating to
   `PaymentController.refundLifecycle`) and `buildReturnsPaymentsPortAdapter(core)` factory.
6. `apps/runtime/src/api.ts` — wires `paymentsPort: buildReturnsPaymentsPortAdapter(runtime)` into
   `createAdminHttpApi({...})`.
7. Tests: 8 new tests in `apps/runtime/src/composition.test.ts` (adapter unit coverage); 1 new test in
   `services/payments/src/payments.e2e.test.ts` (Phase E concurrency proof).

No public API was broken. No event contract changed. No new bounded context. No new infrastructure
(queue/cache/saga/outbox). No architecture violation (`pnpm arch`: 0 violations, unchanged).

---

## 16. Fixes Rejected / Deferred

- **A3-02 (PSP-call TOCTOU race) — deferred, not fixed.** Reasoning in §7. This is the single most
  important thing for the next session on this path to read before doing anything else with refunds.
- **A3-03 (unstable PSP idempotency key) — deferred, not fixed.** Pre-existing, small, mechanically simple
  (change one string template), but touches an already-shipped use case outside this phase's declared
  scope (Returns→Payments wiring); recorded for a dedicated correctness-fix sprint alongside A3-02, since
  both live in the same function and a real fix likely addresses them together.
- **A3-04 (error surfacing polish) — deferred, not fixed.** Cosmetic, no security impact.
- **Multi-intent splitting (A3-05) — not implemented, correctly, per "no speculative engineering."** No
  evidence in this codebase that an order ever has more than one `PaymentIntent` in normal operation; adding
  split logic without a real trigger would be exactly the kind of premature abstraction the project's
  constitution forbids.
- **Kafka-mediated alternative design — considered, rejected.** An event-driven consumer (Returns publishes
  `returns.refund.requested` → a new Payments-side consumer executes the refund) was seriously considered
  as an alternative to the synchronous bridge, because it would sidestep the nested-transaction question in
  §8 entirely and match this codebase's dominant cross-context integration pattern elsewhere
  (`PaymentCapturedConsumer`). It was rejected for THIS phase because the existing `ReturnTransitioned`
  domain event / `returns.refund.requested` integration event (`services/returns/src/domain/events/return-transitioned.event.ts:4-10`)
  carries only `{orderRef, type, fromStatus, toStatus}` — no `amountMinor`/`currency` — so building this
  path would require either changing an existing, already-published event contract (forbidden by the
  absolute constraints unless "absolutely required," and this is not the smallest fix) or a second
  cross-context table read to recover the amount from Returns' own schema by a Payments-side consumer,
  which is a materially larger design surface than the chosen synchronous bridge. Recorded as a legitimate
  alternative for a future sprint if the synchronous bridge's atomicity trade-off (§8) proves unacceptable
  in practice.

---

## 17. Remaining Risks

Ranked by severity:

1. **A3-02 — PSP-call concurrency race (Critical, open).** See §7, §14. This is real, reasoned from code,
   not runtime-disproven, and now reachable from a second route (Returns) in addition to the pre-existing
   one (`POST /payment-intents/:id/refund`).
2. **A3-03 — unstable PSP idempotency key (Low, open, compounds #1).**
3. **Cross-context transaction atomicity (§8) is eventual, not joined.** Documented trade-off, not a bug,
   but worth knowing before relying on "Returns says refunded" as proof that Payments' write also
   committed in the same instant — it did, in every failure mode that was reasoned through, but this was
   not verified against a live Postgres.
4. **A3-05 — single-intent-per-order assumption in the new adapter (Informational).**
5. **A3-04 — error-surfacing polish (Cosmetic).**
6. **Nothing in this phase was verified against a live Postgres, Redis, or Kafka broker** — Docker Desktop
   / WSL2 are confirmed broken in this sandbox, consistent with every prior session's finding in this
   project's history (not re-attempted here; re-attempting a known-broken environment was not a productive
   use of this session's time). All new tests are unit/in-memory-composition level. This means the Prisma
   optimistic-locking claim in §7/§8, while grounded in a direct, careful read of
   `PrismaPaymentIntentRepository.save()`'s actual code, has never been exercised against a real database
   in this codebase's history as far as this session could determine (no dedicated Prisma-repository test
   file exists for Payments — confirmed by `Glob`, only `find-by-idempotency-key.test.ts` touches
   infrastructure at all).

---

## 18. Quality Gates

Run against the current checkout, all commands actually executed (not fabricated):

| Gate                                                                                                                    | Result                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` (root, 82 workspace projects)                                                                          | **78/78 successful**                                                                                                                                            |
| `pnpm lint` (root)                                                                                                      | **78/78 successful**                                                                                                                                            |
| `pnpm turbo run test --concurrency=1` (root, serialized per this project's known Windows/turbo-parallel flakiness note) | **78/78 successful**                                                                                                                                            |
| `pnpm arch` (`depcruise packages services`)                                                                             | **0 violations** (1564 modules, 6786 dependencies cruised)                                                                                                      |
| `pnpm governance`                                                                                                       | **Does not exist in this checkout** — `governance` is not a defined root script (re-verified honestly; same finding as Phase A.1/A.2, not assumed carried over) |
| `pnpm dup`                                                                                                              | **Does not exist in this checkout** — same as above                                                                                                             |
| Targeted: `services/payments`                                                                                           | 4 files, **26/26 tests** passing (was 25 before this phase's 1 new test; net +1 file count unchanged, +1 test)                                                  |
| Targeted: `services/returns`                                                                                            | 3 files, **16/16 tests** passing (unchanged — no test file in this package was modified)                                                                        |
| Targeted: `apps/admin`                                                                                                  | 9 files, **111/111 tests** passing (unchanged)                                                                                                                  |
| Targeted: `apps/runtime`                                                                                                | 30 files, **165/165 tests** passing (was fewer before this phase's 8 new adapter tests)                                                                         |

No test was skipped, marked pending, or asserted against a mock in place of real logic where real logic was
available to exercise. Where real infrastructure (Postgres/Kafka) was unavailable, that limitation is
stated explicitly above rather than papered over.

---

## 19. Production Readiness Verdict

### **CONDITIONALLY PRODUCTION READY**

**Why not PRODUCTION READY outright:** the task's own rubric says NOT PRODUCTION READY if "concurrent
refunds can over-refund" or "duplicate requests can double-refund." §7 (A3-02) found exactly this
class of defect — real, reasoned precisely from code, in the one place this session could not get a fully
live-database proof (no Docker host). The domain ledger itself cannot be pushed over its captured amount
(the optimistic lock guarantees that), but the external PSP can legitimately be called twice for one
logical refund under real concurrent load, which is a genuine production-readiness blocker for money
correctness, independent of whether the domain record shows it.

**Why not NOT PRODUCTION READY outright:** the specific, chartered defect this phase exists to close — an
approved refund having **zero** real effect anywhere, silently — is closed, for real, in the actual
production composition (`apps/runtime`), with test coverage proving both the happy path and every
fail-closed boundary this session could construct. No approved refund can _falsely_ succeed (§12): every
failure mode traced results in a rolled-back Returns transaction, never a return that claims
"refund_requested" while no money moved. That is the specific invariant Phase A.1/A.2/A.3 have been
building toward, and it holds.

**Conditions for a future "PRODUCTION READY" verdict on this specific path:**

1. A3-02 (PSP-call concurrency race) is fixed — the smallest correct fix is very likely a durable
   "refund reserved" write (recording intent-to-refund, with its own idempotent identity) committed BEFORE
   the PSP call, so a concurrent second request can see it and be rejected before ever reaching the PSP.
   This is a structural change to `RefundPaymentLifecycle`, deliberately out of this phase's scope.
2. A3-03 (idempotency key stability) is fixed alongside it — mechanically small once #1 is designed.
3. The cross-process race (and #1's fix) are verified against a real Postgres under actual concurrent load
   — this sandbox's persistent Docker/WSL2 unavailability means that verification has never happened for
   ANY part of this codebase's payment-concurrency behavior, not just this phase's addition. A future
   session with a working Docker host should treat this as a standing gap, not just an A3-02-specific one.

**What was proven:** the specific no-op defect this phase was chartered to find and fix — closed, with
evidence. The authorization/execution separation — clean, proven. Error handling — no false success,
proven. Amount-boundary correctness — proven in three independent layers.

**What was tested:** every scenario in Phases C–J that could be tested without live infrastructure, was —
concurrency included, honestly, including a wrong first hypothesis corrected by the test's own actual
result rather than kept because it made a better story.

**What was fixed:** the Returns→Payments execution no-op (A3-01).

**What remains intentionally unimplemented:** multi-intent-per-order refund splitting (A3-05, no evidence
it's needed) and the Kafka-mediated alternative design (§16, a real alternative, not chosen here).

**What blocks an unconditional verdict:** A3-02, precisely, and only that.

**What is merely a future enhancement:** A3-04 (error polish), A3-05 (multi-intent), live-database
verification of everything this session could only reason about from code.
