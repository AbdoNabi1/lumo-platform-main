# Phase A.6 — Direct Payments Refund Idempotency & Final Refund-Path Security Closure

## 1. Executive Summary

The direct Payments HTTP endpoint `POST /payment-intents/:id/refund` was **vulnerable to duplicate
refunds on client retry**. `RefundPaymentLifecycle` and `PaymentIntent.requestRefund` (Phase A.5)
already implement a fully safe, proven idempotency mechanism — but this HTTP route never fed it a
key. Every retry (timeout, double-click, at-least-once delivery, load-balancer replay) minted a
**brand-new `Refund` reservation and a brand-new PSP idempotency key**, exactly the class of bug
A.5 closed for the Returns path.

**Fix**: additive-only. The route now requires a standard `Idempotency-Key` HTTP header and threads
it into the _already-safe_ domain mechanism built in A.5 — no new idempotency system, no schema
change, no architectural change. A missing/empty key fails closed (`422 VALIDATION`).

- **Files changed**: 1 production file (`apps/admin/src/http/payments-routes.ts`), 1 new test file.
- **Tests added**: 12 (`apps/admin/src/http/direct-refund-idempotency.e2e.test.ts`), all against the
  real route (`route.handle()`), the real `wireAdmin()` composition, and a recording PSP fake.
- **Pre-fix**: 7/12 new tests failed (the exploit proof). **Post-fix**: 12/12 pass.
- **Regression**: A.4 (8 tests) + A.5 (11 tests) + full Payments/Returns/Admin/Runtime suites: all
  green, zero regressions.
- **Verdict**: **PRODUCTION READY** for the code-level guarantee this phase scopes (see §23).

## 2. A.4 Security Baseline (recap, unchanged)

`RefundPaymentLifecycle.reserve()`/`settle()` (`services/payments/src/application/payment-
lifecycle.use-cases.ts`) wrap every write in `withConcurrencyRetry` over
`PrismaPaymentIntentRepository.save`'s optimistic `version` check. Concurrent refunds against the
same `PaymentIntent` either legitimately succeed (capacity allows both) or one loses the race and
retries from a fresh read — never a lost update, never a silent over-refund. Verified unaffected by
this phase (§20).

## 3. A.5 Security Baseline (recap, unchanged)

`PaymentIntent.requestRefund(amount, eventId, occurredAt, idempotencyKey?)`
(`services/payments/src/domain/payment-intent.ts:251-323`):

- If `idempotencyKey` is supplied and an existing `Refund` with that key exists on **this**
  `PaymentIntent`: same amount → return the existing reservation (safe no-op, no new PSP call
  reachable); different amount → `BusinessRuleError` (rejected); `status === "failed"` → rejected,
  a fresh key is required.
- Otherwise: a **new** `Refund` is created (fresh id), checked against `remaining()`.

`Refund.idempotencyKey` is a plain nullable field (`services/payments/src/domain/refund.ts`);
Prisma persists it with `@@unique([intentId, idempotencyKey])`
(`packages/db/prisma/schema/payments.prisma:88-108`, migration
`20260811000000_phase_a5_refund_idempotency`, both pre-existing from A.5, untouched by this phase).

The Returns path (`DecideResolution` → `PaymentsPort.requestRefund` →
`PrismaPaymentsPortAdapter.requestRefund` → `PaymentController.refundLifecycle` →
`RefundPaymentLifecycle`) supplies the stable key `` `${returnId}:refund` `` end-to-end
(`services/returns/src/application/return-lifecycle.use-cases.ts:379-438`,
`apps/runtime/src/composition.ts` `PrismaPaymentsPortAdapter`). **This was already fully safe and
remains fully safe** — untouched by this phase.

## 4. Direct Endpoint Trace (Task 1)

```
POST /api/v1/payment-intents/:paymentIntentId/refund
  apps/admin/src/http/payments-routes.ts:82-124   (route: permission "payments:refund")
    → PaymentsAdminController.refund                  apps/admin/src/interfaces/payments.admin-controller.ts:55-62
      → PaymentController.refundLifecycle              services/payments/src/interfaces/payment.controller.ts:83-85
        → RefundPaymentLifecycle.execute               services/payments/src/application/payment-lifecycle.use-cases.ts:271-450
          reserve(): PaymentIntentRepository.findById → PaymentIntent.requestRefund → save
          PSP call: paymentProvider.refund(pspReference, amountMinor, `${paymentIntentId}:refund:${refundId}`)
          settle(): PaymentIntentRepository.findById → completeRefund/failRefund → save
```

- **Amount/currency**: caller-supplied in the JSON body (`refundBody = { amountMinor, currency }`),
  validated only for shape (positive int, 3-char currency) — checked against `remaining()`
  server-side inside `PaymentIntent.requestRefund`, not trusted blindly.
- **Payment intent identity**: `:paymentIntentId` URL param, looked up via
  `PaymentIntentRepository.findById` — no ownership check beyond tenant scoping (§13).
- **Refund identity**: server-generated (`idGenerator.generate()`), pinned to the domain
  `idempotencyKey` lookup on replay.
- **Idempotency identity (pre-fix)**: none — `refundBody` had no `idempotencyKey` field and the
  route was not `idempotent: true`, so `RefundPaymentLifecycleInput.idempotencyKey` was always
  `undefined`.
- **PSP idempotency key**: `` `${paymentIntentId}:refund:${refundId}` `` — stable across a domain
  replay (same `refundId` reused), but `refundId` itself was fresh every call pre-fix.
- **Authorization**: `AdminGuard.ensure(principal, "payments:refund")` — flat RBAC, no
  object/ownership check (§13).

## 5. Pre-Fix Vulnerability (Task 2)

**A.5 did NOT already make the direct endpoint safe.** `RefundPaymentLifecycle` and
`PaymentIntent.requestRefund` are safe _only when a caller supplies a key_ — the direct HTTP route
never did. Confirmed by reading `refundBody`'s zod schema (no `idempotencyKey` field; extra body
fields are silently stripped by `parseWith`) and the route's `idempotent` flag (absent, so the
generic `Idempotency-Key`-header transport cache in `packages/http/src/server.ts:349-381` never
engaged either). This is a genuine, confirmed gap — not a false positive.

## 6. Exploit Proof (Task 3)

New file: `apps/admin/src/http/direct-refund-idempotency.e2e.test.ts`, driving the **real**
`wireAdmin()` composition through the **real** `route.handle()` (same technique as
`financial-security-remediation.e2e.test.ts`), with a `RecordingPaymentProvider` PSP fake.

Run against the pre-fix route (before any production-code change):

```
Test Files  1 failed (1)
     Tests  7 failed | 5 passed (12)
```

Failures (all expected — this IS the exploit proof):

- Missing/empty `Idempotency-Key` header returned `200` instead of `422` (2 tests) — the header was
  never read, so nothing rejected the request.
- Exact retry with the same key/amount produced **2** PSP calls, not 1 (Attack B/C).
- Concurrent identical requests (same key/amount/intent) produced **2** distinct PSP idempotency
  keys, not 1 (Task 12 Case 5).
- Reusing a key after a PSP failure was silently accepted (`200`) instead of rejected (`409`)
  (Task 11 — tamper/failed-retry protection absent).
- Two calls of "the same logical refund" got two different PSP idempotency keys (Task 16 evidence).

Attack D (same key, different amount) and cross-intent scoping happened to still "pass" pre-fix —
not because they were protected, but because the key was ignored entirely, so those specific
assertions were coincidentally satisfied by unrelated invariants (`remaining()` for the former,
independent PaymentIntent aggregates for the latter). The 7 failures above are the real evidence.

## 7. HTTP Idempotency Contract (Tasks 4, 6)

**Decision**: standard `Idempotency-Key` HTTP header, **not** a new JSON body field, per the task's
explicit preference and to avoid a caller needing to invent a second place to put the same concept
Returns already expresses as a header-shaped concern elsewhere in this file family
(`Stripe-Signature` in `payments-webhook-routes.ts`).

**Decision**: the header is threaded into the **existing domain-level mechanism**
(`RefundPaymentLifecycleInput.idempotencyKey`, already optional and fully wired since A.5) — **not**
the generic transport-level `idempotent: true` response-cache mechanism used by `create`/
`authorize`/`capture` on the same route file. Reasoning: the generic mechanism (`packages/http/src/
server.ts:349-381`) blindly replays a **cached HTTP response** for a reused key regardless of the
new request's body — it has no concept of "same key, different amount" and would silently return
the _first_ response instead of rejecting the tamper attempt (violates Task 3's Attack D
requirement, and Task 4/6's "do not create a second idempotency system"). The domain-level
mechanism already does the correct thing (§3), so the route now reuses it verbatim.

## 8. Missing-Key Policy (Task 7)

**Fail closed**: no header, or an empty-string header → `422` with `code: "VALIDATION"`, before any
repository or PSP call. Status code chosen to match this **repository's own established
convention** — `packages/http/src/error-mapping.ts` and `services/payments/src/interfaces/
presenter.ts` both map `VALIDATION` → `422` uniformly, and `apps/admin/src/http/pricing-
resolution.ts`'s `priceUnresolvedResponse()` is the exact same "boundary rejection, no domain call"
pattern already used elsewhere in this app (returns `{ status: 422, body: toErrorEnvelope(new
ValidationError(...)) }`). The task text's own example (`400`) was not followed, in favor of the
actual codebase convention, per the task's own "choose based on existing repository conventions."

**Compatibility impact**: any existing caller of this endpoint that does not send `Idempotency-Key`
will now receive `422` instead of executing the refund. This is an intentional, disclosed breaking
change — the endpoint is admin/staff-only (never customer-facing), and the alternative (silently
defaulting to unsafe no-dedup behavior on a real-money PSP mutation) is worse.

## 9. Replay Semantics (Task 8)

| Scenario                                         | Behavior                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| First request (key=abc, amount=300)              | Executes refund, `pending` → PSP → `completed`                                                                                           |
| Exact retry (key=abc, amount=300)                | Returns the existing logical refund; **no** new reservation, **no** new PSP call (short-circuits on `alreadyCompleted`)                  |
| Same key, different amount (key=abc, amount=700) | Rejected, `409 BUSINESS_RULE`, PSP never reached                                                                                         |
| Same key, different payment intent               | Distinct logical refund — lookup is scoped to `this.props.refunds` on the _loaded_ `PaymentIntent`, so it cannot collide (verified, §12) |
| Same key, different currency                     | Falls under "different amount"-shaped rejection via `Money` equality (`existing.amount.equals(amount)` compares amount+currency)         |
| Same key after a failed refund                   | Rejected — `BusinessRuleError`, "a new attempt requires a new key" (A.5 semantics, reused verbatim, verified §10)                        |

All verified end-to-end through the real HTTP route in
`direct-refund-idempotency.e2e.test.ts`.

## 10. Pending / Completed / Failed Replay (Tasks 9-11)

- **Pending replay**: not independently re-tested at the HTTP layer — this exact scenario (a
  `pending` reservation, retried with the same key mid-flight) is A.5's own "Scenario A: crash
  between PSP success and settle-commit" test
  (`services/payments/src/refund-idempotency.test.ts:236-277`), which resumes the _same_
  reservation and re-presents the _same_ PSP key. The direct HTTP route now reaches the identical
  `RefundPaymentLifecycle.reserve()` code path with a real key, so this guarantee transfers by
  construction — re-proving it at the HTTP layer would duplicate, not add, coverage.
- **Completed replay**: verified at the HTTP layer (`Attack A/B/C` test) — retry returns `200`,
  zero new PSP calls, one `Refund` row.
- **Failed replay**: verified at the HTTP layer (Task 11 test) — reusing a key after a real PSP
  failure returns `409`; a fresh key (`failed-key:attempt-2`) is accepted as a legitimate new
  attempt and succeeds. No `failed → completed` transition is possible through key reuse — the
  lookup in `requestRefund` explicitly throws before any state mutation.

## 11. Concurrency Results (Task 12)

Re-run through the real HTTP route (not just the lifecycle):

| Case                                                              | Result                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case 5 — same key, same amount, same intent, concurrent           | One logical refund, PSP idempotency keys collapse to a set of size 1, `realEffects = 1`                                                                 |
| Case 2 — different keys, same intent, concurrent-shaped (500+500) | Two legitimate refunds, two PSP calls                                                                                                                   |
| A.4 cases (700+700 exclusive; 500+500 both-fit)                   | Re-verified unaffected at the lifecycle-test level (§20) — this phase changed only the HTTP layer, not `RefundPaymentLifecycle`'s concurrency mechanism |

Case 3/4 (partial-capacity races) are exactly what A.4's own `refund-concurrency.test.ts` already
proves at the lifecycle level; not duplicated here since the mechanism is untouched.

## 12. Cross-Key Isolation (Task 13)

Verified via a dedicated test: the same raw `Idempotency-Key` string sent against **two different**
payment intents produces **two distinct** refunds with two distinct PSP idempotency keys. This is
correct **by construction**, not by any new code this phase added — `PaymentIntent.requestRefund`'s
lookup (`this.props.refunds.find(r => r.idempotencyKey === idempotencyKey)`) only ever searches the
refunds of the **one** `PaymentIntent` aggregate that was loaded by `paymentIntentId`, and the
Prisma unique constraint is `@@unique([intentId, idempotencyKey])` — composite, not on
`idempotencyKey` alone. No server-side prefixing/namespacing was added or needed (Task 5): the key
is already correctly scoped per-payment-intent by the existing A.5 design.

**Not addressed** (documented, not a regression): two _different, unrelated_ staff callers reusing
the identical raw key string on the _same_ payment intent would collapse into one logical refund —
inherent to any bare Idempotency-Key convention scoped per-resource (matches Stripe's own model:
keys are scoped to the account, not per-caller). Given this endpoint requires the `payments:refund`
permission (trusted staff only) and no cross-tenant path exists, this is a low-severity,
architecture-wide characteristic, not a Phase A.6-introduced gap — flagged for awareness, not fixed
(no engineering was added for it, per the "no speculative engineering" constraint).

## 13. Authorization Findings (Task 14)

**Not remediated in this phase — documented.** `AdminGuard.ensure(principal, "payments:refund")` is
a flat RBAC permission check with **no object-level/ownership check**: any principal holding
`payments:refund` can refund _any_ payment intent in the resolved tenant by id. Verified with a
dedicated test (`otherStaff` with no relation to the seeded order successfully refunds it, `200`).

This is not a Phase A.6 regression — it is the exact same pattern already present on the Returns
resolution route (`returns:resolution`, same flat-RBAC shape, same absence of an ownership check)
and on every other admin route in this codebase (`AdminGuard` is inherently a permission-only gate,
by design — ADR-0007's "permissive until real RBAC lands" and the broader move to Keto/ReBAC for
object-level checks is out of scope for a single-endpoint refund-idempotency phase). Remediating it
would mean redesigning cross-cutting admin authorization, explicitly forbidden by this phase's "DO
NOT redesign" constraint. Recommended as a candidate for a future, dedicated authorization-hardening
phase spanning the whole admin surface, not just Payments.

## 14. Amount Integrity (Task 15)

Unaffected and re-verified: `amountMinor > remaining()` is rejected (`409 BUSINESS_RULE`, "Refund
exceeds the captured amount") even when a syntactically valid, unused `Idempotency-Key` is
supplied — the amount check in `PaymentIntent.requestRefund` runs after the idempotency-key lookup
finds no existing match, so a fresh over-refund attempt is still blocked exactly as A.4 established.
Verified via a dedicated HTTP-layer test (5000 against a 1000 captured intent → `409`, zero PSP
calls).

## 15. PSP Idempotency Evidence (Task 16)

`RecordingPaymentProvider` (test fake) records every call's `(providerIntentId, amountMinor,
idempotencyKey)`. Verified through the real route:

- Same logical refund replayed with the same key: the **replay never reaches the PSP at all**
  (short-circuits domain-side on `alreadyCompleted`) — stronger than "same PSP key," since zero
  redundant network calls are made once the reservation is `completed`.
- Two distinct keys on the same intent: two distinct PSP idempotency keys, both real PSP calls
  (`realEffects = 2`).

No claim of exactly-once PSP-side execution beyond what `PaymentProvider.refund`'s contract
documents (`packages/contracts/src/payment-provider.ts:1-6`: "providers dedupe on it") — this
codebase can only guarantee every retry presents the _same_ identity, matching A.5's own documented
scope.

## 16. Crash/Failure Injection (Task 17)

- **Failure 1 (crash after reservation, before PSP)** and **Failure 3 (PSP response lost)**: covered
  by A.5's existing "Scenario A" simulation
  (`services/payments/src/refund-idempotency.test.ts:236-277`), which the direct route now reaches
  by the identical code path once it supplies a real key (§10) — not re-simulated at the HTTP layer
  to avoid duplicating an already-labeled simulation.
- **Failure 2 (PSP succeeds, `completed`-persistence fails)**: not separately simulated this phase;
  the `settle()` write path and its failure semantics are unchanged from A.4/A.5 and out of this
  phase's diff.
- **Failure 4 (HTTP client retries after timeout)**: this **is** exactly what Attack B/C (§9) proves
  end-to-end through the real route — the retry (same key) is a safe no-op.
- **Failure 5 (two replicas receive the same idempotent request)**: modeled by the concurrency
  test (§11, Case 5) — two concurrent `route.handle()` invocations against the same in-process
  fake repository, labeled as an in-process simulation, not a real multi-process/distributed proof
  (no live Postgres/replica environment was available in this sandbox — same limitation prior
  phases in this project's history have disclosed).

## 17. Repository-Wide Refund Path Matrix (Task 18)

| Path                                                                                                                                                    | Reachable                                                                                                                               | Authenticated                       | Idempotent                                                           | Amount protected                                               | Concurrency protected               | Production                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /payment-intents/:id/refund` (direct Payments)                                                                                                    | Yes                                                                                                                                     | Yes (Bearer + `payments:refund`)    | **YES (fixed this phase)**                                           | Yes (`remaining()`, A.4)                                       | Yes (optimistic-lock retry, A.4)    | Yes — Prisma repo + `StripePaymentProvider` when composed with `prisma`+`paymentProvider` (verified, §19)                                                                                       |
| `POST /returns/:returnId/resolution` (outcome=refund)                                                                                                   | Yes                                                                                                                                     | Yes (Bearer + `returns:resolution`) | Yes (A.5 — `<returnId>:refund`, plus route-level `idempotent: true`) | Yes (`RefundVerificationPort`, Phase A.1 F-04 + `remaining()`) | Yes (same `RefundPaymentLifecycle`) | Yes — `PrismaPaymentsPortAdapter` → real `RefundPaymentLifecycle`                                                                                                                               |
| `PaymentController.refund` / legacy `RefundPayment` use case                                                                                            | **No** — confirmed no HTTP route calls `.refund()`; only `.refundLifecycle()` is wired to any route (`payments.admin-controller.ts:61`) | N/A                                 | N/A                                                                  | N/A                                                            | N/A                                 | N/A — dead code path, not reachable in production                                                                                                                                               |
| `POST /orders/:orderId/refund` (Orders bookkeeping `RefundOrder`)                                                                                       | Yes                                                                                                                                     | Yes (`orders:refund`)               | N/A                                                                  | N/A                                                            | N/A                                 | Runs no PSP call at all (`order.refund(refundPolicy, ...)` is a pure order-status transition, no `PaymentProvider` dependency) — a different bounded-context concept, not a money-movement path |
| `services/returns` `InMemoryPaymentsAdapter.requestRefund`                                                                                              | Only when `paymentsPort` isn't injected                                                                                                 | N/A                                 | No-op stub                                                           | N/A                                                            | N/A                                 | **Not production** — `apps/runtime/src/api.ts` boot guard requires a real adapter outside `local`                                                                                               |
| Test-only call sites (`refund-idempotency.test.ts`, `refund-concurrency.test.ts`, `direct-refund-idempotency.e2e.test.ts`, `decide-resolution.test.ts`) | Test-only                                                                                                                               | N/A                                 | N/A                                                                  | N/A                                                            | N/A                                 | N/A                                                                                                                                                                                             |

No silently-forgotten reachable refund path was found.

## 18. Persistence/Migration Review (Task 19)

**No persistence or schema changes were made in this phase.** `Refund.idempotencyKey` and its
`@@unique([intentId, idempotencyKey])` constraint already existed from Phase A.5
(migration `packages/db/prisma/schema/migrations/20260811000000_phase_a5_refund_idempotency/`,
pre-existing, untouched). This phase is purely an HTTP-layer wiring change — no `prisma generate`,
no mapper change, no repository query change was required or made.

## 19. Production Composition (Task 21)

Verified via `apps/runtime`'s own test suite (166/166 passing, unchanged by this phase):
`apps/runtime/src/composition.test.ts` confirms `paymentProvider` resolves to the real
`StripePaymentProvider` once `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are configured, and
`apps/runtime/src/api.ts`'s `assertProductionPaymentProviderConfigured` fails closed outside
`APP_ENV=local` without one. `apps/admin/src/composition.ts:486` wires `admin.payments` from the
same `wirePayments()` composition that receives that `paymentProvider` and a `PrismaPaymentIntent
Repository` whenever `prisma` is present. `payments-routes.ts` (the file this phase changed) is the
**one, unconditional** route definition used identically in every environment — there is no
test-only branch in the route file itself, so the fix applies to the real production route by
construction, not just to an isolated test composition.

## 20. Regression Results (Task 20)

| Suite                                                                                                                                                       | Result                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `services/payments` full suite (incl. A.4 `refund-concurrency.test.ts`, A.5 `refund-idempotency.test.ts`)                                                   | 6 files, **45/45 passed**    |
| `services/returns` full suite                                                                                                                               | 3 files, **16/16 passed**    |
| `apps/admin` full suite (incl. new A.6 file, Phase A.1 `financial-security-remediation.e2e.test.ts`, `admin-http.e2e.test.ts`, webhook/tenant-guard suites) | 10 files, **123/123 passed** |
| `apps/runtime` full suite (composition/production-wiring)                                                                                                   | 30 files, **166/166 passed** |
| Repo-wide `pnpm test` (turbo, all 78 packages)                                                                                                              | **78/78 successful**         |

Zero regressions against A.4 or A.5 guarantees.

## 21. Quality Gates (Task 22)

```
pnpm typecheck   → 78/78 packages successful (one pre-existing TS6133 in the new test file, fixed)
pnpm test        → 78/78 packages successful
pnpm lint        → 78/78 packages successful
pnpm arch        → ✔ no dependency violations found (1564 modules, 6787 dependencies cruised)
pnpm governance  → NOT AVAILABLE IN THIS CHECKOUT (no such script in root package.json)
pnpm dup         → NOT AVAILABLE IN THIS CHECKOUT (no such script in root package.json)
```

## 22. Remaining Risks

- **Authorization** (§13): flat RBAC only, no object-level ownership check — architecture-wide,
  shared with Returns, explicitly out of this phase's scope.
- **Cross-caller key collision** (§12): two different staff principals reusing the identical raw
  key on the same payment intent collapse into one refund — inherent to bare Idempotency-Key
  scoping, low severity given the trusted-staff-only permission gate.
- **Failure 2 / Failure 5** (§16): partially simulated only; no live Postgres/multi-replica
  verification was available in this sandbox (consistent with this project's prior phases'
  disclosed limitation).
- **Compatibility break** (§8): any pre-existing caller not sending `Idempotency-Key` now gets
  `422` instead of executing — intentional, disclosed, not a defect.

## 23. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY.**

All code-level guarantees required by this phase are met:

- The direct refund endpoint is now idempotent (domain-level, reusing A.5's proven mechanism).
- The same logical refund cannot create multiple PSP operations through HTTP retries (verified,
  §6, §9, §15).
- Amount integrity remains enforced (§14).
- A.4 concurrency protections remain intact (§11, §20).
- A.5 idempotency protections remain intact (§20).
- Authorization is architecturally consistent with the rest of the admin surface (not upgraded,
  not regressed — §13).
- Production composition is verified (§19).
- All tests and available quality gates pass (§20, §21).

Marked _conditional_ rather than unconditional because: live PSP/multi-replica/Postgres
verification was not available in this sandbox (§16, Failure 5), and the pre-existing
cross-tenant/cross-caller key-collision characteristic (§12) and the flat-RBAC authorization model
(§13) remain unproven beyond "matches the rest of this codebase's existing, accepted design."

Nothing in this phase was committed, per instruction.
