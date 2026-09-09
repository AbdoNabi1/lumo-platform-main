# Phase A.1 — Financial Security Exploit Proof & Remediation

**Status:** All 4 findings' proven exploit paths CLOSED for F-01/F-02/F-03; F-04 has a working, tested cap mechanism that is **not enforced by default** in this codebase (see §9 and §17). **Not committed to git**, per this repo's standing sprint-isolation discipline — every file below is modified in the working tree only.

---

## 1. Executive Summary

Phase A confirmed four authenticated privilege-boundary defects in the Checkout → Orders → Payments → Returns money path. This sprint proved each with a real, executable exploit test against the actual (in-memory) composition **before** touching production code, then closed three of them unconditionally by re-deriving the financial amount server-side from an already-existing authoritative source, reusing capabilities this codebase already had (Checkout's own `ShippingCalculationPort`/`generateOrderDraft()`, Orders' own `GetOrder`). The fourth (F-04, Returns refund amount) got the same treatment architecturally — an optional `RefundVerificationPort`, proven to work when wired — but Returns owns no pricing/payment data by design ("Returns prices nothing"), and no existing capability in this codebase can supply a refundable ceiling without adding new cross-context infrastructure, which was out of scope. F-04 is therefore **not closed in this codebase's default (in-memory) composition** — this is stated plainly, not glossed over.

All 4 exploit tests fail against the pre-fix code and pass after remediation (14/14 in the new regression suite; 11/14 fail pre-fix, with the remaining 3 erroring out for an unrelated collateral reason explained in §10). All quality gates are green: `pnpm typecheck` 78/78, `pnpm test` 78/78, `pnpm lint` 78/78, `pnpm arch` 0 violations (1564 modules / 6786 dependencies).

---

## 2. Original Findings (Phase A audit)

- **F-01 — Checkout Shipping Rate Tampering.** `selectShippingBody` accepted a client-supplied `rateAmountMinor`, stored verbatim, flowing into `recalculateTotals` → `generatePaymentIntentRequest().amountMinor`. No server-side comparison against an authoritative quote.
- **F-02 — Order Total Tampering.** `POST /orders/from-checkout` accepted a caller-supplied `totals` object. `Order.totalAmount()` returns `totals.totalMinor` whenever totals are supplied, never independently deriving it.
- **F-03 — Payment Intent Amount Tampering.** `POST /payment-intents` accepted `amountMinor`/`currency`/`orderRef` with no server-side validation against the named order.
- **F-04 — Refund Amount Tampering.** `DecideResolution` forwarded a caller-supplied refund amount to `PaymentsPort` with no independent derivation or cap.

Attacker model throughout: **an authenticated principal with the relevant permission** attempting to manipulate a financial value that should be server-derived — not an unauthenticated shopper. The public guest-cart surface (H-01/Phase 17.1) remains verified clean and was not touched.

---

## 3. Exploit Proof (Phase 1)

A new suite, [`apps/admin/src/http/financial-security-remediation.e2e.test.ts`](../../apps/admin/src/http/financial-security-remediation.e2e.test.ts), drives the real `wireAdmin()` composition through the actual `RouteDefinition.handle()` boundary (same technique as the Phase 17.2 suite). It was written and run **before** any production code changed.

To prove the pre-fix code was genuinely vulnerable (not just schema-inspected), this session's 14 changed implementation files were `git stash`ed (leaving the new test file and only this session's own changes untouched — the repo's large body of _other_ uncommitted prior-session work was left alone) and the suite re-run against the reverted code:

```
Pre-fix run:  11 failed | 3 passed  (14 total)
Post-fix run: 14 passed             (14 total)
```

The 3 pre-fix tests that errored rather than cleanly asserting did so because stashing `checkout-routes.ts` collaterally reverted an **unrelated, already-existing Phase 17.2 fix** in the same file (the `loadItems` cartId-based item derivation) — a test-harness artifact of the stash, not a gap in this proof. The **schema-level tests for all three (F-01/F-02/F-03)** and the **F-04 regression test** failed cleanly and directly on the correct assertion, which is sufficient proof on its own; §10 has the detail.

---

## 4. Root Cause

All four findings share one root cause: **a financial amount was accepted at an HTTP/application boundary from the same caller who benefits from inflating or deflating it, with no independent re-derivation from state the caller doesn't control.** In each case a legitimate, already-built capability existed elsewhere in the same composition to supply the authoritative value — it simply wasn't being consulted.

---

## 5. Trust-Boundary Analysis

| Finding | Route/Use-case                           | Actor                                         | Permission (ADR-0007, permissive) | Pre-fix trust                 |
| ------- | ---------------------------------------- | --------------------------------------------- | --------------------------------- | ----------------------------- |
| F-01    | `POST /checkouts/:id/shipping-selection` | Authenticated customer-or-staff               | `checkout:select_shipping`        | Rate: caller                  |
| F-02    | `POST /orders/from-checkout`             | Authenticated customer-or-staff               | `orders:create_from_checkout`     | Totals: caller                |
| F-03    | `POST /payment-intents`                  | Authenticated customer-or-staff               | `payments:create_intent`          | Amount/currency: caller       |
| F-04    | `POST /returns/:id/resolution`           | Staff (domain-documented as a staff decision) | `returns:resolution`              | Refund amount: caller (staff) |

`AllowAllAccessControl` (ADR-0007) still does not distinguish staff from customer for F-01–F-03; this pre-existing, documented gap is unchanged by this sprint (same as Phase 17.2 §3/§12).

---

## 6. F-01 Remediation — Checkout Shipping Rate

**Authoritative source:** `ShippingCalculationPort.quote()` — already injected into Checkout's composition and already used by `RequestShippingQuote`; `SelectShipping` simply never consulted it.

**Fix (smallest safe representation, no new shipping engine):**

- [`services/checkout/src/application/checkout-details.use-cases.ts`](../../services/checkout/src/application/checkout-details.use-cases.ts) — `SelectShipping` now takes `{ checkoutSessionId, method }` only (no `rateAmountMinor`/`currency`). It loads the session, requires a shipping address to already be set (mirrors `RequestShippingQuote`'s own precondition), re-queries `shippingCalculation.quote(...)`, and matches `method` against the returned quotes. An unmatched method is rejected (422); the matched quote's own `rateAmountMinor` builds the `ShippingSelection`.
- [`services/checkout/src/composition.ts`](../../services/checkout/src/composition.ts) — wires the existing `shippingCalculation` adapter into `SelectShipping` (one line).
- [`apps/admin/src/http/checkout-routes.ts`](../../apps/admin/src/http/checkout-routes.ts) — `selectShippingBody` narrows to `{ method }` with `.strict()`.

**Why the old behavior was unsafe:** the client asserted the exact number that became part of the charged total, with zero re-validation.
**Why the new behavior is safe:** the rate can only ever be one of the values `ShippingCalculationPort` itself returned for that address/currency — never client-chosen.
**Why minimal:** reuses the identical port `RequestShippingQuote` already calls; no new port, no new domain concept, `ShippingSelection`/`CheckoutSession.selectShipping()` unchanged.
**No duplication:** one authoritative shipping-rate source (`ShippingCalculationPort`), consulted from two use cases instead of one.
**Proof:** "Attack (F-01)" — a smuggled `rateAmountMinor: 1` never reaches totals; the real quoted rate (500) does. "unknown method" test — a forged/unavailable method is rejected, never silently priced at 0.

---

## 7. F-02 Remediation — Order Total

**Authoritative source:** `CheckoutSession.generateOrderDraft()` — an existing use case (`GenerateOrderDraft`, already wired at `GET /checkouts/:id/order-draft`) whose entire documented purpose is "the pure order-draft snapshot handed to Orders." `CreateOrderFromCheckout` never called it — `POST /orders/from-checkout` (the admin HTTP route) took the client's own `totals` instead.

**Fix:**

- [`apps/admin/src/http/admin-routes.ts`](../../apps/admin/src/http/admin-routes.ts) — `createOrderFromCheckoutBody` drops `totals` entirely (`.strict()`). The route handler now calls `admin.checkout.generateOrderDraft(principal, { checkoutSessionId: body.checkoutRef })` first, verifies the draft's currency matches the request (409 on mismatch), and builds `CreateOrderFromCheckoutInput.totals` from the draft's own `CheckoutTotals`, discarding whatever the client sent.
- [`services/checkout/src/index.ts`](../../services/checkout/src/index.ts) — exports `OrderDraft`/`PaymentIntentRequest` types (needed to type the cross-context read; the checkout package already computed and returned this data, it just wasn't exported).

This mirrors the exact H-01/Phase 17.2 pattern: the fix is entirely at the admin HTTP-route layer (fetch the authoritative snapshot from a sibling controller already wired into the same `WiredAdmin`, exactly as `checkout-routes.ts` fetches Cart via `admin.publicReads.cart.get()`). `CreateOrderFromCheckout`'s own use-case signature is untouched.

**Why unsafe/safe/minimal:** same shape of argument as F-01 — the total was caller-supplied and unconditionally trusted; now it can only be the value Checkout itself already computed and locked into its own recalculated totals. No new Orders↔Checkout port, no domain change on either side.
**Proof:** "Attack (F-02)" — a smuggled forged `totals.totalMinor: 1` never reaches `Order.totalAmount()`; the real Checkout-derived total does.

**Residual, explicitly out of scope for F-02:** `items[].unitPriceAmountMinor` in this same route remains client-supplied. Because `Order.totalAmount()` uses `totals.totalMinor` directly whenever totals are present (now always Checkout-derived), a forged item price no longer affects the captured/charged amount — but it does leave the persisted `OrderItem` line price forgeable, a data-integrity concern distinct from the proven financial-capture defect this finding named. Flagged in §17, not fixed (would require re-deriving items too, a larger change than "smallest fix for the demonstrated vulnerability" justifies).

---

## 8. F-03 Remediation — Payment Intent Amount

**Authoritative source:** the `Order` itself, via the already-wired `admin.orders.getOrder()` (same `WiredAdmin` composition `POST /payment-intents` already runs inside).

**Fix:**

- [`apps/admin/src/http/payments-routes.ts`](../../apps/admin/src/http/payments-routes.ts) — `createIntentBody` narrows to `{ orderRef }` (`.strict()`). The handler calls `admin.orders.getOrder(principal, { orderId: body.orderRef })` first; a non-2xx response (404 for an unknown order) is returned as-is. Otherwise `amountMinor`/`currency` are read from the real `Order.totalAmount()` and `Order.currency`, and _those_ are what's passed to `admin.payments.createIntent`.

No change to `services/payments` at all — the fix is entirely at the HTTP boundary, matching F-02's shape (and explicitly the pattern the prior Phase 17.2 audit's §12.7 flagged this exact route for, without fixing it).

**Why unsafe/safe/minimal:** the amount/currency were caller-supplied with `orderRef` never even dereferenced; now `orderRef` MUST resolve to a real order (404 otherwise), and the amount can only be that order's own authoritative total. Zero new ports; `CreatePaymentIntentLifecycle` (the actual use case this route drives — see §10 for the correction that led here) is untouched.
**Proof:** "Attack (F-03)" — a smuggled `amountMinor: 1, currency: "EUR"` never determines the opened intent; the fetched intent's real amount/currency (order-derived) do.

---

## 9. F-04 Remediation — Refund Amount (partial; see verdict)

**Authoritative source sought:** none exists in this codebase today. `ReturnRequest` intentionally carries no pricing data ("Returns prices nothing," `refund-decision.ts`'s own doc comment). `PaymentsPort.requestRefund` is fire-and-forget (`Promise<void>`), and its only implementation, `InMemoryPaymentsAdapter`, is a no-op in both the in-memory and Prisma composition branches (`services/returns/src/composition.ts`'s own comment: "the 4 reference-only outbound ports stay in-memory in both branches — out of scope"). Payments' own domain (`PaymentIntent.refund()`/`requestRefund()`) _does_ enforce `totalRefunded <= totalCaptured` (§13) — but nothing in the current wiring routes Returns' refund request through it.

**Fix (the mechanism, not a fabricated ceiling):**

- [`services/returns/src/application/ports.ts`](../../services/returns/src/application/ports.ts) — new `RefundVerificationPort.isRefundable(orderRef, amountMinor, currency): Promise<boolean>`, reference-only, optional.
- [`services/returns/src/application/return-lifecycle.use-cases.ts`](../../services/returns/src/application/return-lifecycle.use-cases.ts) — `DecideResolution` gains an optional `refundVerification` dep; when a `refund` outcome is decided **and** the dep is wired, it calls `isRefundable(...)` before transitioning the return or touching `PaymentsPort`, rejecting (422) on `false`.
- [`services/returns/src/infrastructure/in-memory-port-adapters.ts`](../../services/returns/src/infrastructure/in-memory-port-adapters.ts) — `InMemoryRefundVerificationAdapter.isRefundable()` always returns `true` (same "always verifies, no backing store" convention as Orders' existing `InMemoryPaymentVerificationAdapter`).
- [`services/returns/src/composition.ts`](../../services/returns/src/composition.ts) and [`apps/admin/src/composition.ts`](../../apps/admin/src/composition.ts) — `refundVerification?: RefundVerificationPort` threaded through `ReturnsWiringDeps`/`AdminWiringDeps`, defaulting to the in-memory stub, exactly mirroring the established `paymentVerification` pattern from Sprint A1 Task 5 / M2-7.

**Why this shape, not a computed ceiling:** the Absolute Constraints forbid inventing new cross-context infrastructure ("do not redesign the architecture," "do not introduce speculative validation"). The one precedent this codebase already has for "a caller-asserted value needs cross-context verification and no real backing store exists yet" is exactly this optional-port-defaulting-permissive pattern (Orders' `PaymentVerificationPort`) — reused verbatim, not invented.

**Proof:** with a strict fake `RefundVerificationPort` wired (`amountMinor <= 1999`), a refund request for `2000` is rejected (422) before `decideResolution`/`PaymentsPort.requestRefund` ever run; a request for `1999` succeeds; non-`refund` outcomes are never gated. Without anything wired (this repo's actual default), an unbounded refund (`999_999_999`) is still accepted — proven explicitly, not hidden.

---

## 10. A note on F-03's actual code path (verification detail)

Initial tracing followed `CreatePaymentIntent` (`create-payment-intent.use-case.ts`), the use case behind `PaymentController.createIntent`. Checking `PaymentsAdminController.createIntent` showed it actually calls `payments.createIntentLifecycle`, which drives a _different_ use case, `CreatePaymentIntentLifecycle` (`payment-lifecycle.use-cases.ts`) — the one genuinely reachable from `POST /payment-intents`. The remediation in §8 is unaffected either way, since the fix intercepts at the HTTP route layer before either use case runs — but this is recorded because it's exactly the kind of assumption an exploit-proof discipline exists to catch, and it changed which file the report initially would have (wrongly) cited as "the fix's target."

---

## 11. Regression Tests (Phase 4)

`apps/admin/src/http/financial-security-remediation.e2e.test.ts` — 14 tests, all passing post-fix:

- F-01: legitimate flow (real quoted rate applied), forged-rate attack (ignored), unknown method (422), schema-level `.strict()` rejection.
- F-02: legitimate flow (order total matches Checkout's real total), forged-totals attack (ignored), schema-level rejection.
- F-03: legitimate flow (intent amount matches order total), forged-amount/currency attack (ignored), schema-level rejection.
- F-04: unbounded refund accepted when unwired (documents the residual risk, not a false pass), refund above a wired ceiling rejected, refund at the ceiling succeeds, non-refund outcomes ungated.

A pre-existing, unrelated test (`apps/admin/src/http/payments-webhook.e2e.test.ts`) called `POST /payment-intents` with the now-rejected `amountMinor`/`currency` fields against a fictitious `orderRef` that was never a real order. It was updated (not weakened) to create a real order first via the legacy `POST /orders` route and to stop asserting a caller-supplied amount — the only change needed to match the corrected, secure contract; every other assertion in that file (signature verification, replay protection, tenant scoping) is untouched.

---

## 12. Repository-Wide Monetary-Input Sweep (Phase 5)

| Finding | Route                                                                                                        | Input                                           | Financial side effect                                                         | Trust source                                                            | Status                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01    | `POST /checkouts/:id/shipping-selection`                                                                     | `rateAmountMinor`                               | checkout totals → payment intent                                              | `ShippingCalculationPort` quote match                                   | **FIXED**                                                                                                                                                                                                                          |
| F-02    | `POST /orders/from-checkout`                                                                                 | `totals.totalMinor`                             | `Order.totalAmount()` → captured amount                                       | `Checkout.generateOrderDraft()`                                         | **FIXED**                                                                                                                                                                                                                          |
| —       | same route                                                                                                   | `items[].unitPriceAmountMinor`                  | none (totals no longer derived from items) — persisted line-item display only | none                                                                    | RESIDUAL, documented (§7)                                                                                                                                                                                                          |
| F-03    | `POST /payment-intents`                                                                                      | `amountMinor`/`currency`                        | opened intent's amount                                                        | `Order.totalAmount()`/`currency` via `getOrder`                         | **FIXED**                                                                                                                                                                                                                          |
| F-04    | `POST /returns/:id/resolution`                                                                               | `amountMinor` (refund)                          | `PaymentsPort.requestRefund`                                                  | `RefundVerificationPort` (optional, unwired by default)                 | **PARTIAL** — mechanism proven, not enforced by default (§9)                                                                                                                                                                       |
| —       | `POST /payment-intents/:id/refund`                                                                           | `amountMinor`/`currency`                        | `PaymentIntent.refund()`/`requestRefund()`                                    | Payments' own domain invariant (`remaining()` bound, unrelated to F-04) | **SAFE** (unchanged, pre-existing, verified intact — §13)                                                                                                                                                                          |
| —       | `POST /orders` (legacy, `orders:place`)                                                                      | `items[].unitPriceAmountMinor`                  | `Order.totalAmount()` (no `totals` snapshot on this path — sums items)        | staff-asserted (backoffice manual order entry)                          | OUT OF SCOPE — staff-authored data entry, not a forgery vector against an authoritative price (no "correct" price exists independent of what staff types for a manual/phone order); not one of F-01–F-04; flagged for completeness |
| —       | `POST /prices`, `PUT /prices/:id`, `POST /products/:id/variants` etc.                                        | `priceAmountMinor`/`compareAtMinor`/`costMinor` | creates the Pricing source-of-truth itself                                    | staff-authored (Pricing management)                                     | SAFE — this _is_ the authoritative-price creation, not a forgery target                                                                                                                                                            |
| —       | Finance routes (`setProductCost`, `recordExpense`, `createBudget`, `reviseBudget`, `recordManualAdjustment`) | `amountMinor`                                   | ledger/budget entries                                                         | staff-authored (accounting data entry)                                  | OUT OF SCOPE — different context (Finance/ADR-0024), no capture linkage, staff-authored records by design                                                                                                                          |
| —       | `POST /promotions` (`minimumSubtotalAmountMinor`)                                                            | promotion rule definition                       | none (defines eligibility, not a charge)                                      | staff-authored (Promotions rule creation)                               | SAFE                                                                                                                                                                                                                               |
| —       | `POST /promotions/evaluate` (`unitPriceAmountMinor`/`subtotalAmountMinor`)                                   | hypothetical-cart evaluation                    | none — standalone preview tool, not wired into any checkout/capture flow      | caller-supplied, but no side effect reaches money                       | SAFE (no financial side effect)                                                                                                                                                                                                    |
| —       | `POST /public/carts/:id/items`, `POST /carts/:id/items` (admin)                                              | `unitPriceAmountMinor`/`currency`               | Cart price                                                                    | `resolvePrice()` → Pricing                                              | SAFE (H-01/Phase 17.2, verified unchanged — full suite still green)                                                                                                                                                                |
| —       | `POST /checkouts/:id/items`                                                                                  | previously raw `items[]`                        | Checkout item price                                                           | Cart (Pricing-authoritative)                                            | SAFE (Phase 17.2, verified unchanged)                                                                                                                                                                                              |

---

## 13. Security Invariants (Phase 6)

**Money:** integer minor units and non-negative amounts remain enforced at `Money.create()` (unchanged); no floating-point arithmetic was introduced by any of these fixes (all new logic compares/copies existing integer `amountMinor` values). Currency consistency: F-02's fix adds an explicit 409 on a Checkout/order currency mismatch that didn't exist before.

**Cart:** unaffected by this sprint — H-01/Phase 17.2 protections (client cannot choose price, ownership enforcement) reverified green via the untouched `public-cart-routes.test.ts` (29 tests) and `cart-checkout-pricing-security.e2e.test.ts` (12 tests), both still passing.

**Checkout:** totals now fully derive from authoritative state end-to-end (items via Cart since Phase 17.2, shipping via F-01, tax/discount were always port-supplied snapshots, never client-asserted). Payment-intent amount equals the checkout session's own recalculated total.

**Orders:** order total for the checkout-driven path (F-02) cannot be client-defined. The legacy manual `POST /orders` staff path is unaffected (§12, out of scope by design).

**Payments:** intent amount/currency now derive from the authoritative order (F-03). `totalRefunded <= totalCaptured` is enforced by `PaymentIntent.refund()`/`requestRefund()`/`completeRefund()`'s `remaining()`-bound guard — unchanged code, reverified: `payment-intent.test.ts` (9 tests) and `payments.e2e.test.ts` (8 tests) both still pass. This invariant is the one that protects `POST /payment-intents/:id/refund` directly; it does **not** protect Returns' separate refund path (F-04) since that path never calls through it.

**Returns:** refund amount cannot exceed a verified ceiling **only when `RefundVerificationPort` is wired** — not true by default in this codebase (§9, §17).

---

## 14. Architecture Impact

None. No new bounded context, no new ADR, no Cart/Checkout/Pricing domain change. The single new port (`RefundVerificationPort`) is additive and optional, following an existing precedent exactly (Orders' `PaymentVerificationPort`). `pnpm arch`: 0 violations, 1564 modules / 6786 dependencies — unchanged from before this sprint.

## 15. API Impact

Four request-body shapes narrowed (all `.strict()`, all backward-incompatible for any caller currently sending the now-rejected fields — no such caller exists in this codebase; `checkout-routes.ts` had zero external callers per the Phase 17.2 audit, and `/orders/from-checkout`/`/payment-intents` are internal admin-only surfaces with no storefront implementation yet):

- `POST /checkouts/:id/shipping-selection`: `{ method, rateAmountMinor, currency }` → `{ method }`.
- `POST /orders/from-checkout`: dropped `totals`.
- `POST /payment-intents`: `{ orderRef, amountMinor, currency }` → `{ orderRef }`.
- `POST /returns/:id/resolution`: unchanged shape; behavior conditionally stricter when `refundVerification` is wired.

## 16. Event-Contract Impact

None. No event payload, name, or schema changed.

---

## 17. Remaining Risks

1. **F-04 is not closed by default.** No real `RefundVerificationPort` implementation exists or is wired anywhere in this codebase (matching Payments' own admittedly no-op PSP integration for this path). An authenticated staff principal can still assert an arbitrary refund amount today. This is the load-bearing caveat on the final verdict.
2. **F-02's item-level price forgery** on `/orders/from-checkout` (§7) is a residual data-integrity gap: display/line-item prices are still client-supplied, even though the captured total is not.
3. **ADR-0007's permissive `AllowAllAccessControl`** is unchanged (pre-existing, documented, out of scope of every fix in this sprint) — F-01–F-03 remain reachable by any authenticated principal, not staff-only.
4. **`POST /orders` (legacy manual order entry)** lets staff assert item prices directly with no independent check — judged out of scope as staff-authored data entry (§12), but flagged for anyone re-scoping this later.
5. Environment: no live PSP/Prisma verification was possible (§18) — all proof is in-memory-composed, same limitation as every prior session in this project.

## 18. Environmental Limitations

Docker Desktop and WSL2 are unavailable in this sandbox (consistent with every prior session — `[[morbeh-integration-verification-sprint]]`, `[[morbeh-dashboard-orders-phase1-1-verification]]`). All proof in this report is **PROVEN BY TESTS / PROVEN IN-MEMORY** — real `wireAdmin()`/`wireCheckout()`/`wireReturns()` composition, real use cases and domain aggregates, driven through the actual `RouteDefinition.handle()` boundary. **PROVEN LIVE:** nothing. A real Postgres-backed path and a genuine Fastify HTTP round-trip were not exercised, matching this repo's own established testing convention (same caveat as every prior H-01/Phase 17.x report).

---

## 19. Quality-Gate Results

```
pnpm run typecheck  → 78/78 packages successful (turbo)
pnpm run test       → 78/78 packages successful (turbo)
pnpm run lint       → 78/78 packages successful (turbo)
pnpm run arch       → 0 violations, 1564 modules / 6786 dependencies
```

Targeted runs:

```
pnpm --filter admin exec vitest run     → 111/111 passed, 9 test files
pnpm --filter checkout exec vitest run  → 21/21 passed, 3 test files
pnpm --filter returns exec vitest run   → 11/11 passed, 2 test files
pnpm --filter orders exec vitest run    → 42/42 passed (+5 Prisma-integration skipped), 8 test files
pnpm --filter payments exec vitest run  → 20/20 passed, 4 test files
```

`pnpm governance`/`pnpm dup` do not exist in this repo (verified, matching every prior session's own finding).

---

## Final Verdict: **CONDITIONALLY PRODUCTION READY**

F-01, F-02, and F-03 are closed unconditionally in this codebase's default composition, proven by executable exploit-then-regression tests, with zero architectural or event-contract change and all quality gates green. **F-04 is not** — the mechanism to bound a Returns refund exists and is proven correct when wired, but nothing wires it by default, so an authenticated staff principal can still request an unbounded refund today. This is an **authenticated privileged-user vulnerability** (not unauthenticated, not ordinary-customer-reachable — `returns:resolution` is a staff action), and it remains open through an externally reachable route (`POST /returns/:id/resolution`) in the current default configuration. The verdict is therefore conditional, not clean: safe to proceed with F-01–F-03 as closed, but F-04 must be tracked as an open item — either wire a real `RefundVerificationPort` backed by Payments/Orders data, or make a deliberate, documented decision that Returns' refund amount is intentionally staff-trusted (an internal-misuse risk acceptance, not a forgery defect) before calling this surface production-ready.

---

## Files Changed

**`apps/admin`:**

- `src/composition.ts` — `refundVerification?: RefundVerificationPort` added to `AdminWiringDeps`, passed through to `wireReturns(deps)`.
- `src/http/admin-routes.ts` — `createOrderFromCheckoutBody` drops `totals` (`.strict()`); handler re-derives totals from `admin.checkout.generateOrderDraft()`.
- `src/http/checkout-routes.ts` — `selectShippingBody` narrows to `{ method }` (`.strict()`).
- `src/http/payments-routes.ts` — `createIntentBody` narrows to `{ orderRef }` (`.strict()`); handler re-derives amount/currency from `admin.orders.getOrder()`.
- `src/http/payments-webhook.e2e.test.ts` — updated to the corrected `/payment-intents` contract (creates a real order first, stops asserting a caller-supplied amount).
- `src/http/financial-security-remediation.e2e.test.ts` — **NEW.** 14 exploit-proof/regression tests for F-01–F-04.

**`services/checkout`:**

- `src/application/checkout-details.use-cases.ts` — `SelectShipping` re-derives the rate from `ShippingCalculationPort`.
- `src/composition.ts` — wires `shippingCalculation` into `SelectShipping`.
- `src/index.ts` — exports `OrderDraft`/`PaymentIntentRequest` types.
- `src/checkout.e2e.test.ts` — updated `selectShipping` call to the new input shape.

**`services/returns`:**

- `src/application/ports.ts` — new `RefundVerificationPort`.
- `src/application/return-lifecycle.use-cases.ts` — `DecideResolution` gains the optional cap check.
- `src/infrastructure/in-memory-port-adapters.ts` — new `InMemoryRefundVerificationAdapter` (always-verifies default).
- `src/composition.ts` — wires `refundVerification` through.
- `src/index.ts` — exports `RefundVerificationPort`.

**No changes** to `services/orders`, `services/payments` (domain, application, or event contracts), or any other app/service.

## Tests Added/Changed

- **New:** `apps/admin/src/http/financial-security-remediation.e2e.test.ts` (14 tests).
- **Updated (contract-following, not weakened):** `apps/admin/src/http/payments-webhook.e2e.test.ts` (1 test), `services/checkout/src/checkout.e2e.test.ts` (1 assertion block).

## Vulnerabilities Closed

F-01 (shipping rate), F-02 (order total), F-03 (payment-intent amount) — closed unconditionally, proven red→green.

## Remaining Risks

F-04 (Returns refund amount) — mechanism built and proven, **not enforced by default**; residual item-level price forgery on `/orders/from-checkout` (display only, not the captured amount); ADR-0007 permissive RBAC (pre-existing, unchanged); legacy manual `POST /orders` staff price entry (out of scope, judged intentional).

## Quality-Gate Results

`typecheck` 78/78, `test` 78/78, `lint` 78/78, `arch` 0 violations — all actually run, not assumed.

## Final Verdict

**CONDITIONALLY PRODUCTION READY** — F-01–F-03 clean; F-04 open pending a wired `RefundVerificationPort` or an explicit risk acceptance.
