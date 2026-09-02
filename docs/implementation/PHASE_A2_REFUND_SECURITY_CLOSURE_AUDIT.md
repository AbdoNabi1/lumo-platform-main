# Phase A.2 — Refund Security Closure Audit (F-04)

**Date:** 2026-08-10
**Scope:** `services/returns`, `services/payments`, `apps/admin`, `apps/runtime` (money paths only)
**Predecessor:** `PHASE_A1_FINANCIAL_SECURITY_REMEDIATION_REPORT.md` (F-01/F-02/F-03 closed, F-04 left open)
**Mandate:** determine whether F-04 (Refund Amount Tampering) can be closed **without** new
cross-context architecture, a new bounded context, a new ADR, a new database/table, or a second
source of truth for refundable amounts. Production changes were permitted only if an existing
capability could close the gap.

---

## 1. Executive Summary

F-04 is **now closed for the real production entrypoint** (`apps/runtime`), via composition-only
wiring of a new read-only adapter — **Outcome B** ("existing capability exists but is not wired").
No new architecture, bounded context, table, or dependency direction was introduced.

What was found and done:

- **The refund flow was fully traced** (Task 1). `POST /returns/:returnId/resolution` →
  `DecideResolution` → `PaymentsPort.requestRefund(orderRef, amountMinor, currency, idempotencyKey)`.
  A second, previously-undocumented fact: `services/returns/src/composition.ts` hardcodes
  `paymentsPort = new InMemoryPaymentsAdapter()` **unconditionally** — unlike `refundVerification`,
  it is not even parameterized through `ReturnsWiringDeps`. In this repository's current
  composition, Returns' refund request never reaches a real Payments side effect at all, in any
  environment. This is a separate, pre-existing gap from F-04 and is called out under Remaining
  Risks — it was **not** remediated here (would require a new cross-context write-path adapter,
  out of this audit's "no new architecture" mandate, and is not what F-04 asked about).
- **An authoritative source already exists** (Task 2): Payments' own `payment_intents` /
  `charges` / `refunds` Prisma tables (schema unchanged since Sprint 4.8), plus the exact reusable
  pattern for reading them from a foreign composition root — `PrismaPaymentVerificationAdapter`
  (Sprint A1 Task 5 / M2-7), which already does this for Orders' analogous
  `PaymentVerificationPort`.
- **Architecture ownership is unambiguous** (Task 3): Payments owns `refundableAmount`. Orders'
  aggregate carries no captured/refunded amounts at all (only order total + status). Returns
  correctly asks Payments via a port — exactly the same dependency direction and mechanism Orders
  already uses (`Orders → Payments` via `PaymentVerificationPort`; `Returns → Payments` via
  `RefundVerificationPort`, both concrete adapters live in `apps/runtime`, never importing
  `@platform/payments` from Returns' own code).
- **The exploit was proven, both before and after** (Task 4): a new unit test drives
  `DecideResolution` directly with a spy `PaymentsPort`, proving a caller-asserted `5000` (against
  captured=1000, alreadyRefunded=200) reaches `PaymentsPort.requestRefund` verbatim when no
  `refundVerification` is wired, and is rejected **before** `PaymentsPort` is ever called once the
  new adapter is wired.
- **The Payments domain invariant was proven independently** (Task 5): `PaymentIntent.requestRefund`
  already enforces `totalRefunded <= totalCaptured` for any caller that routes through it —
  but Returns' `DecideResolution` never touches a `PaymentIntent`, so that invariant provides
  **zero** protection for the Returns path on its own. It fully protects the _other_ refund path,
  `POST /payment-intents/:id/refund` (see Task 8/9).
- **Remediation implemented** (Task 6, Outcome B): a new `PrismaRefundVerificationAdapter`
  (mirroring `PrismaPaymentVerificationAdapter` exactly) in `apps/runtime/src/composition.ts`,
  wired into `createAdminHttpApi(...)` in `apps/runtime/src/api.ts` — the same convention as
  `paymentVerification`. Zero new tables, zero new dependency directions, zero architecture change.
- **All Phase A.1 findings remain closed** (Task 9): the full financial-security-remediation e2e
  suite (F-01–F-04, 14 tests) passes unchanged.
- **All 4 requested quality gates are green** (Task 10): typecheck 78/78, test 78/78, lint 78/78,
  arch 0 violations.

**Final verdict: CONDITIONALLY PRODUCTION READY** (see §17). F-04 is closed for the real production
composition root (`apps/runtime`); one adjacent, pre-existing gap (Returns' `PaymentsPort` sink
being a hardcoded no-op even in "production" composition) remains open and is documented, not
fixed, because fixing it is a different, larger piece of work outside this audit's scope
("Returns → Payments real write adapter" — a new capability, not a wiring gap).

---

## 2. F-04 Exploit Proof

Two new tests in `services/returns/src/application/decide-resolution.test.ts` drive the real
`DecideResolution` use case directly with a spy `PaymentsPort`, so the claim is proven at the
actual call boundary (not inferred from the return's resulting HTTP status):

```
captured = 1000, alreadyRefunded = 200 (remaining = 800), requested = 5000
```

- **Unwired (this repo's default `wireReturns`/`wireAdmin` composition — no `refundVerification`
  supplied):** `DecideResolution.execute({ outcome: "refund", amountMinor: 5000, currency: "USD" })`
  returns `ok`, and `PaymentsPort.requestRefund` is called **exactly once with `amountMinor: 5000`
  verbatim**. The vulnerability is real and reachable.
- **Wired (`refundVerification` = the new `PrismaRefundVerificationAdapter`, simulated via a fake
  computing the identical ceiling):** the same call returns `err` (`ValidationError`, HTTP 422 at
  the route layer per the existing Phase A.1 test), and `PaymentsPort.requestRefund` is **never
  called** — the ceiling check short-circuits `DecideResolution` before the aggregate transition and
  before the refund request (`return-lifecycle.use-cases.ts:389-407`, unchanged from Phase A.1).

This directly answers Task 4: **yes, `5000` reaches `PaymentsPort` when unwired; no, it does not
reach `PaymentsPort` when the new adapter is wired** — which is now the case for `apps/runtime`'s
real composition (§6).

---

## 3. Refund Data Flow (Task 1)

```
POST /returns/:returnId/resolution
  → returns-routes.ts (zod: outcome/amountMinor?/currency?)
  → ReturnsAdminController.resolution()  (AdminGuard.ensure("returns:resolution"))
  → ReturnsController.resolution()
  → DecideResolution.execute()                       [services/returns/src/application/return-lifecycle.use-cases.ts:368]
      1. RefundDecision.create(outcome, amountMinor, currency)   — shape validation only
      2. load ReturnRequest by returnId (orderRef comes from the loaded aggregate, NOT from the
         request body — no order-ref forgery surface)
      3. IF outcome=="refund" AND refundVerification is wired:
           refundVerification.isRefundable(orderRef, amountMinor, currency) → reject (422) if false
      4. returnRequest.decideResolution(decision, ...)   — status-machine transition, throws if
         already resolved (items_accepted → refund_requested is the ONLY legal entry; re-entry from
         refund_requested is rejected, see §7)
      5. returns.save(returnRequest)
      6. IF outcome=="refund": paymentsPort.requestRefund(orderRef, amountMinor, currency,
         `${returnId}:refund`)   — deterministic idempotency key
      7. notifyBestEffort (reference-only, never blocks)
```

- **Refund amount origin:** caller-supplied HTTP body (`amountMinor`/`currency`), zod-validated for
  shape only (positive int, 3-char currency), never for value against any ceiling by default.
- **Order reference origin:** the `ReturnRequest` aggregate loaded by `returnId` — **not**
  caller-suppliable at resolution time. Closes the order-ref-forgery angle by construction.
- **Payment reference origin:** none — `PaymentsPort.requestRefund` takes `orderRef`, not a
  payment/intent id. Nothing for a caller to target at another payment via this path.
- **Captured amount:** known only inside `services/payments` — `PaymentIntent.charges[]` (Prisma
  `charges` table, `amount_minor` per charge, FK to `payment_intents.id`).
- **Already-refunded amount:** known only inside `services/payments` — `PaymentIntent.refunds[]`
  (Prisma `refunds` table).
- **Refundable amount (derivable):** `sum(charges.amountMinor) - sum(refunds.amountMinor)` across
  every `payment_intents` row for the order, in the requested currency. This is exactly what the
  new `PrismaRefundVerificationAdapter` computes (§6).
- **`PaymentsPort` → adapter:** `services/returns/src/composition.ts:79` hardcodes
  `new InMemoryPaymentsAdapter()` (a no-op) unconditionally — this field is not exposed on
  `ReturnsWiringDeps` at all. **Independent of F-04**, this repo's current composition never routes
  a Returns refund request to a real Payments side effect in any environment (see §16, Risk 1).

---

## 4. Existing Authoritative Sources (Task 2)

Searched for `PaymentVerificationPort`, `PaymentsPort`, `PaymentIntent`, `Payment`, `Refund`,
`totalCaptured`, `totalRefunded`, `refund`, `captured`, `Order`, `getOrder`, "payment verification".

| Source                                                                                                | What it knows                                                                                                                                                                                                                     | Reusable as-is?                                                            |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `PaymentIntent` domain aggregate (`services/payments/src/domain/payment-intent.ts`)                   | `charges[]`, `refunds[]`, `remaining()` (private)                                                                                                                                                                                 | Domain-internal only — not reachable cross-context without an adapter      |
| `payment_intents` / `charges` / `refunds` Prisma tables (`packages/db/prisma/schema/payments.prisma`) | Same data, persisted, tenant-scoped, indexed by `orderRef`                                                                                                                                                                        | **Yes** — same schema `PrismaPaymentIntentRepository` already reads/writes |
| `PrismaPaymentVerificationAdapter` (`apps/runtime/src/composition.ts:249`)                            | Not the refund ceiling itself, but the **exact reusable pattern**: read-only, tenant-scoped Prisma query against `payment_intents` from a foreign composition root, implementing an Orders-owned port (`PaymentVerificationPort`) | **Yes** — mirrored exactly for `RefundVerificationPort`                    |
| `RefundVerificationPort` (`services/returns/src/application/ports.ts`, added Phase A.1)               | The contract itself — already correctly shaped (`orderRef, amountMinor, currency → boolean`)                                                                                                                                      | **Yes** — no interface change needed                                       |
| Order aggregate (`services/orders/src/domain/order.ts`)                                               | Only order status + a status-gated `refund()`/`requestRefund()` (whole-order marker, no amounts)                                                                                                                                  | No — Orders tracks no captured/refunded amounts at all                     |

**Conclusion:** the correct capability (Payments' own ledger) and the correct pattern
(`PrismaPaymentVerificationAdapter`) both already exist. Nothing needed inventing.

---

## 5. Architecture Ownership Analysis (Task 3)

1. **Should Returns calculate `refundableAmount`?** No — Returns prices nothing by design (stated
   directly in `ReturnRequest`'s and `RefundDecision`'s own doc comments), and owns no captured/
   refunded data.
2. **Should Payments calculate it?** Yes — Payments is the only context holding `charges`/`refunds`.
3. **Should Orders calculate it?** No — Orders' aggregate has no amount-level refund tracking, only
   a status marker (§4).
4. **Should Returns ask Payments for the authoritative ceiling?** Yes, via a port — which is
   precisely what `RefundVerificationPort` already is.
5. **Is there already a port allowing this without a new dependency direction?** Yes.
   `Returns → Payments` (conceptually, via a composition-root adapter) is the **same shape** as the
   already-approved `Orders → Payments` (`PaymentVerificationPort`/`PrismaPaymentVerificationAdapter`).
   Neither Returns' nor Payments' own package code imports the other — the adapter lives in
   `apps/runtime`, which already legitimately imports both `@platform/returns` (port type) and the
   shared Prisma client (Payments' schema), exactly as it already does for Orders/Payments. No
   `Returns → Pricing` or `Returns → Checkout` edge was introduced or was ever necessary.

This confirms **Outcome B**: the correct capability and the correct port already exist; only the
composition wiring (plus one small adapter class following an established template) was missing.

---

## 6. Remediation (Outcome B — wired, no redesign)

### 6.1 New adapter

`apps/runtime/src/composition.ts` — `PrismaRefundVerificationAdapter implements RefundVerificationPort`,
placed immediately after `PrismaPaymentVerificationAdapter` and following its exact shape:

```ts
async isRefundable(orderRef, amountMinor, currency) {
  const intents = await this.prisma.paymentIntent.findMany({
    where: { orderRef, tenantId: this.tenantId, currency },
    include: { charges: true, refunds: true },
  });
  const totalCaptured = intents.reduce((sum, i) => sum + i.charges.reduce((s, c) => s + c.amountMinor, 0), 0);
  const totalRefunded = intents.reduce((sum, i) => sum + i.refunds.reduce((s, r) => s + r.amountMinor, 0), 0);
  return amountMinor <= totalCaptured - totalRefunded;
}
```

Read-only, tenant-scoped, sums across every payment intent for the order (handles multiple intents
per order correctly), scoped by currency (a currency mismatch is treated as unverifiable → rejected).
Never imports `@platform/payments` — same decoupling convention as every other cross-context port
adapter in this codebase.

### 6.2 Wiring

`apps/runtime/src/api.ts` — `createAdminHttpApi(...)` now also passes:

```ts
refundVerification: new PrismaRefundVerificationAdapter(runtime.prisma, runtime.config.TENANT_DEFAULT_ID),
```

immediately after the existing `paymentVerification` wiring — identical convention. `wireAdmin`'s
own default (`InMemoryRefundVerificationAdapter`, always-true) is **unchanged** — it remains the
correct fallback for tests and any composition that doesn't supply Prisma, exactly like
`paymentVerification`'s own default.

### 6.3 Dependency

`apps/runtime/package.json` now depends on `@platform/returns` (`workspace:*`) — it already
transitively used the package's types via `RefundVerificationPort`'s Phase A.1 addition but had
never declared the dependency explicitly; `pnpm typecheck` caught the missing declaration
immediately (turbo failed closed, not silently).

No table, no ADR, no new bounded context, no new dependency direction.

---

## 7. Existing Payment Invariant Analysis (Task 5)

New tests in `services/payments/src/domain/payment-intent.test.ts`
(`PaymentIntent.requestRefund — totalRefunded <= totalCaptured invariant`), fixture
captured=1000/alreadyRefunded=200 (remaining=800):

| Case                            | Amount                   | Expected | Result                        |
| ------------------------------- | ------------------------ | -------- | ----------------------------- |
| Valid                           | 300                      | succeeds | ✅ passes                     |
| Boundary                        | 800                      | succeeds | ✅ passes                     |
| Invalid                         | 801                      | fails    | ✅ throws `BusinessRuleError` |
| Extreme                         | 5,000                    | fails    | ✅ throws `BusinessRuleError` |
| Legacy `refund()` (own fixture) | 801 fails / 800 succeeds |          | ✅ both hold                  |

**Does this invariant protect the HTTP/application boundary, or only internal Payment state?**
**Both — but only for callers that route through it.** `RefundPaymentLifecycle`
(`services/payments/src/application/payment-lifecycle.use-cases.ts:255`) calls
`intent.requestRefund(amount)` before ever calling the PSP or completing the refund — so
`POST /payment-intents/:id/refund` (§9) **is** protected by this invariant today, independent of
F-04. Returns' `DecideResolution`, however, **never constructs or loads a `PaymentIntent`** — it
only calls the reference-only `PaymentsPort.requestRefund(orderRef, amount, currency, key)`
interface. The domain invariant therefore provides **zero** protection for the Returns path on its
own; F-04's closure had to happen at the Returns/Payments port boundary (§6), which is what was
done.

---

## 8. Object-Level Authorization Analysis (Task 7)

- **Refund more than captured / more than remaining:** now blocked for `apps/runtime`'s real
  composition (§6); was open by default before (§2).
- **Manipulate payment reference to target another payment:** not applicable to
  `DecideResolution` — it takes no payment/intent id, only the aggregate's own `orderRef`.
- **Manipulate order reference to target another order:** not possible — `orderRef` comes from the
  loaded `ReturnRequest`, never from the request body (§3).
- **Bypass authorization by changing identifiers:** `returnId` is a path param resolved to a
  concrete aggregate; no identifier substitution changes which order is affected.
- **Cause duplicate refunds through repeated requests:** see §9 — blocked at the state-machine
  level, independent of the route's `idempotent: true` flag.
- **Caveat (pre-existing, out of scope):** `AdminGuard`/`AllowAllAccessControl` is permissive by
  design until real RBAC lands (ADR-0007) — `returns:resolution`, and every other admin permission,
  is granted to any authenticated principal today. This is a systemic, already-documented gap
  spanning the whole admin surface (not specific to F-04, not introduced or worsened by this audit)
  and was correctly left untouched per the "no unrelated staging" sprint-isolation rule.

---

## 9. Duplicate/Idempotency Analysis (Task 7)

- The route is `idempotent: true`, and `DecideResolution` derives a deterministic idempotency key
  (`${returnId}:refund`) for `PaymentsPort.requestRefund` — stable across retries.
- Independent of that key, the **state machine itself blocks re-entry**: `TRANSITIONS` for
  `refund_requested` only allows `→ closed` (`return-status.ts:27`); calling `decideResolution`
  twice on the same return throws `BusinessRuleError` on the second call, before `PaymentsPort` is
  reached. Proven by a new test: `paymentsPort.calls` has length 1 after two `DecideResolution`
  calls on the same return.

---

## 10. Equivalent Refund Paths (Task 8)

Repo-wide search for `refund`, `refundAmount`, `amountMinor`, `PaymentsPort`, `DecideResolution`.
Three surfaces touch "refund" in some sense; only two move money:

| Route                                                 | Caller                                                | Auth                              | Amount Source          | Authoritative Validation                                                                                                                                                | Status                           |
| ----------------------------------------------------- | ----------------------------------------------------- | --------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `POST /returns/:returnId/resolution` (outcome=refund) | any authenticated principal (`AllowAllAccessControl`) | `returns:resolution` (permissive) | caller-supplied body   | **Now yes**, for `apps/runtime`'s real composition (§6); `wireAdmin`'s own bare default remains unwired (documented residual, matches `paymentVerification` convention) | Closed in production composition |
| `POST /payment-intents/:paymentIntentId/refund`       | any authenticated principal                           | `payments:refund` (permissive)    | caller-supplied body   | **Yes, always** — `RefundPaymentLifecycle` → `PaymentIntent.requestRefund()` domain invariant (§7), independent of F-04's fix                                           | Already protected                |
| `POST /orders/:orderId/refund`                        | any authenticated principal                           | `orders:refund` (permissive)      | none (no amount field) | N/A — status-only marker (`RefundPolicy.canRefund(status)`), never calls `PaymentsPort`, moves no money                                                                 | Not a money-movement path        |

`services/licensing`'s own `PaymentsPort` (`collect(tenantRef, amount, currency)`) is a
differently-shaped, unrelated interface (subscription billing collection, not refunds) — confirmed
not a fourth refund path.

---

## 11. Whether Existing Capability Closes F-04 (Task 6 conclusion)

**Outcome B.** Confirmed via Tasks 2–5: the authoritative data (Payments' `payment_intents`/
`charges`/`refunds`) and the exact adapter pattern (`PrismaPaymentVerificationAdapter`) already
existed; `RefundVerificationPort` already existed from Phase A.1; only the concrete adapter class
and the `apps/runtime/src/api.ts` wiring line were missing. No architecture decision was required.

---

## 12. Remediation Summary

- **Files changed (production code):**
  - `apps/runtime/src/composition.ts` — new `PrismaRefundVerificationAdapter` class + import.
  - `apps/runtime/src/api.ts` — wires `refundVerification` into `createAdminHttpApi(...)`.
  - `apps/runtime/package.json` — declares the `@platform/returns` dependency the new import needs.
  - `pnpm-lock.yaml` — updated by `pnpm install` for the new workspace edge.
- **Files changed (tests):**
  - `apps/runtime/src/composition.test.ts` — 9 new offline unit tests for
    `PrismaRefundVerificationAdapter` (valid/boundary/invalid/extreme/multi-intent/tenant-isolation/
    currency-mismatch/zero-captured), mirroring the existing `PrismaPaymentVerificationAdapter`
    fixture pattern (fake Prisma, no DB).
  - `services/payments/src/domain/payment-intent.test.ts` — 5 new tests proving the
    `totalRefunded <= totalCaptured` invariant (§7).
  - `services/returns/src/application/decide-resolution.test.ts` (**new file** — Returns'
    application layer had zero unit tests before this audit) — 5 tests proving reachability to
    `PaymentsPort` with a spy, both unwired (exploit) and wired (regression), plus the duplicate-
    refund state-machine guard (§9).
- **Not changed:** `services/returns/src/**` production code, `apps/admin/src/**`,
  `RefundVerificationPort`'s interface, `wireAdmin`'s/`wireReturns`'s own default composition. The
  Phase A.1 F-04 mechanism (optional port, always-verify stub default) was already correctly shaped
  — only the missing real-adapter half was added, at the one composition root that matters
  (`apps/runtime`).

---

## 13. Regression Tests

19 new tests across 3 files (9 + 5 + 5), all passing (§14). See §12 for file list and §2/§7/§9 for
what each group proves.

---

## 14. Phase A.1 Regression Status

`apps/admin/src/http/financial-security-remediation.e2e.test.ts` — **14/14 passing, unchanged**:

- F-01 (shipping rate): 4/4 passing — forged `rateAmountMinor` still ignored.
- F-02 (order total): 3/3 passing — forged `totals.totalMinor` still ignored.
- F-03 (payment-intent amount): 3/3 passing — forged `amountMinor`/`currency` still ignored.
- F-04 (refund amount): 4/4 passing, including the pre-existing "Attack (F-04, documented residual
  risk)" test — which **still correctly documents** that `wireAdmin()`'s own bare default (used
  directly, bypassing `apps/runtime/src/api.ts`) remains unwired. This is intentional and expected:
  the fix lives at the real production entrypoint's composition, not inside `wireAdmin`'s default,
  matching the established `paymentVerification` convention exactly.

Also verified unchanged: public guest cart security, cart price server-derivation, payment-intent
amount derivation from Order, checkout total derivation from authoritative state — all covered by
the same suite and by `apps/admin`'s broader e2e tests, unaffected by this session's changes
(no `apps/admin`/`apps/storefront`/checkout/cart files were touched).

---

## 15. Quality-Gate Results

Ran directly, full output captured:

| Gate             | Result                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` | **78/78 packages passing** (initially failed with `TS2307: Cannot find module '@platform/returns'` in `apps/runtime` until the package.json dependency was declared and `pnpm install` run — then green) |
| `pnpm test`      | **78/78 packages passing**, all new tests included                                                                                                                                                       |
| `pnpm lint`      | **78/78 packages passing**                                                                                                                                                                               |
| `pnpm arch`      | **0 dependency violations** (1564 modules, 6786 dependencies cruised)                                                                                                                                    |

Directly affected package tests (also run individually, all green): `@platform/returns` (16 tests,
incl. 5 new), `@platform/payments` (25 tests, incl. 5 new), `@platform/runtime` (157 tests, incl. 9
new), `@platform/admin`'s `financial-security-remediation.e2e.test.ts` (14 tests, unchanged).

`pnpm governance`/`pnpm dup` (mentioned in prior-session memory as additional gates) were **not**
runnable in this checkout — no `governance`/`dup` script exists in the current root
`package.json` and `scripts/governance` has no `package.json` of its own, only build artifacts. Not
one of the 4 gates this audit was explicitly asked to run; not chased further, consistent with
"don't chase a clean state beyond what was asked."

No Docker/WSL2 database or Redis in this sandbox (confirmed broken in every prior session per
project memory) — `apps/runtime`'s Prisma/Redis-touching tests warn/skip gracefully by design
(`ioredis` connection errors, `prisma.$queryRawUnsafe` connection failure, both non-fatal, matching
prior sessions' documented behavior) and do not affect the 157/157 pass count.

---

## 16. Remaining Risks

1. **Returns' `PaymentsPort` is a hardcoded no-op in every environment, independent of F-04.**
   `services/returns/src/composition.ts:79` — `paymentsPort = new InMemoryPaymentsAdapter()`,
   unconditional, not exposed on `ReturnsWiringDeps`. Even with F-04 now correctly gating the
   _amount_, an approved refund request currently has **no real side effect** anywhere in this
   codebase — Returns' refund flow reaches no PSP, no ledger, nothing. Closing this needs a new
   write-path adapter bridging Returns → Payments' `RefundPaymentLifecycle` (or a Kafka-mediated
   equivalent), which is materially larger than a wiring fix (a real cross-context call path, not
   just a read-only ceiling check) and was correctly out of this audit's "no new architecture"
   mandate. Flagged, not fixed.
2. **RBAC is permissive repo-wide** (`AllowAllAccessControl`, ADR-0007) — `returns:resolution`,
   `payments:refund`, and every other admin permission are granted to any authenticated principal
   until real RBAC (Ory/Keto) lands. Pre-existing, systemic, already documented; not specific to
   refunds and not worsened by this audit.
3. **`wireAdmin`'s/`wireReturns`'s own bare defaults remain unwired by design** — any future caller
   of `wireAdmin(deps)` that doesn't explicitly supply `refundVerification` (e.g. a new test
   harness, a future admin variant) silently gets the always-true stub. This mirrors
   `paymentVerification`'s identical, already-accepted risk shape — not a new pattern.
4. **Currency-mismatch handling is conservative, not permissive:** `PrismaRefundVerificationAdapter`
   treats any currency other than an exact match on captured intents as unverifiable (rejects). This
   is the safe direction for a security gate but should be revisited if legitimate multi-currency
   captures per order are ever supported.

---

## 17. Final Verdict

### CONDITIONALLY PRODUCTION READY

F-04 is genuinely closed for `apps/runtime`'s real composition root — the only place a live
deployment actually boots from — via an existing capability (Payments' own ledger) reused through
an existing, already-proven pattern (`PrismaPaymentVerificationAdapter`'s shape), with zero
architecture change. F-01/F-02/F-03 remain closed, unregressed. All 4 requested quality gates are
green (typecheck 78/78, test 78/78, lint 78/78, arch 0 violations).

The "conditionally" qualifier is **not** because F-04 itself is incomplete — it is because Risk 1
(§16) means an approved, amount-bounded refund still has no real downstream effect in this
codebase's current state (Returns → Payments has no real write adapter at all, a pre-existing gap
this audit correctly did not attempt to close), and Risk 2 (repo-wide permissive RBAC) remains a
standing, documented condition on every admin action in this system, refunds included.

No changes were committed, per standing sprint-isolation discipline.
