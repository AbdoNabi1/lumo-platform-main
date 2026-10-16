# Phase 17.2 — Authenticated Cart & Checkout Security Audit + Remediation

**Status:** VULNERABLE found and FIXED for the scope defined below. **Not committed to git**, per this repo's standing sprint-isolation discipline — every file below is modified in the working tree only.

---

## 1. Executive Summary

H-01 (Phase 17.1) closed price forgery on the **public, unauthenticated** Cart surface. This audit examined the two authenticated surfaces flagged as out-of-scope at the time: `apps/admin/src/http/cart-routes.ts` (the admin-authenticated Cart HTTP surface) and `apps/admin/src/http/checkout-routes.ts` (Checkout's only HTTP surface, admin-authenticated).

**Verdict: VULNERABLE (pre-fix) → FIXED (post-fix).** Both surfaces accepted a caller-supplied `unitPriceAmountMinor`/`currency` and stored/propagated it verbatim, with **no revalidation against Pricing anywhere in the chain**. Checkout was the more severe of the two: a fully client-fabricated line-item snapshot — never tied to any real Cart — flowed unchanged through `loadItems → recalculateTotals → generatePaymentIntentRequest`, becoming the exact `amountMinor` that would be handed to Payments to charge. The only nominal safeguard, `ValidateCheckout`'s `PricingValidationPort`, is an offline stub (`InMemoryPricingValidationAdapter`) that only checks `amount >= 0` — it never calls Pricing and reports any forged amount `valid: true`. This is not a hypothetical: `AllowAllAccessControl` (ADR-0007, the RBAC seam, "permissive until Phase 2") does not distinguish a staff/admin operator from an ordinary authenticated customer, so any caller who can obtain any valid auth token for this system could reach both routes.

Both defects were proven with real, in-memory-composed exploit tests before any code changed (Task 4), then fixed with the smallest change consistent with the codebase's own H-01 precedent: **stop accepting the price at the HTTP boundary and resolve it server-side**, reusing existing capabilities only. No Cart, Checkout, or Pricing domain/application code changed; no event contract changed; the `LoadItems` use case's input shape is untouched. All 78 packages' typecheck/lint/test pass; `pnpm arch` reports 0 violations across 1564 modules / 6782 dependencies; the new regression suite (12 tests) plus the full pre-existing 97-test admin app suite all pass.

---

## 2. Scope

**In scope (per this audit's brief):**

- `apps/admin/src/http/cart-routes.ts` — the admin-authenticated Cart HTTP surface (`cart:add_item`, `cart:replace_variant`, and the rest of the Cart lifecycle).
- `apps/admin/src/http/checkout-routes.ts` — Checkout's only HTTP surface (`checkout:load_items`, `checkout:validate`, `checkout:recalculate`, `checkout:generate_payment_intent_request`, and the rest of the session lifecycle).
- The complete pricing data flow from these two boundaries through to the payment-intent-request handed to Payments.

**Explicitly out of scope (per the task's Absolute Constraints):** redesigning Cart, Checkout, or Pricing; introducing a new bounded context; changing event contracts; touching Payments' own `POST /payment-intents` route or `services/payments`; fixing the pre-existing, documented ADR-0007 "permissive until Phase 2" RBAC gap itself (only its _consequence_ for pricing is closed here — see §3 and §12).

---

## 3. Trust Boundaries

| Actor                                       | Reaches `cart-routes.ts` / `checkout-routes.ts`?             | Notes                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous / guest shopper                   | No — these routes require a `Principal` (not `public: true`) | Guest surface is `public-cart-routes.ts` (H-01, already remediated).                                                                                                                                  |
| Authenticated customer (`kind: "customer"`) | **Yes**                                                      | The JWT verifier (`packages/auth/src/jwt-verifier.ts`) defaults `kind` to `"customer"` when the token has no explicit `kind` claim. Nothing in the pipeline restricts these two route files to staff. |
| Authenticated staff (`kind: "staff"`)       | Yes                                                          | The intended operator, per the doc comments on `CartAdminController`/`CheckoutAdminController` ("merchant-admin operator").                                                                           |
| Service-to-service (`kind: "service"`)      | Yes                                                          | No distinct treatment.                                                                                                                                                                                |

**`authenticated != trusted pricing source` is directly relevant here, and the code does not currently honor it.** `AdminGuard.ensure()` calls `AccessControl.authorize(principal, permission)`; `wireAdmin`'s default `AccessControl` is `AllowAllAccessControl`, which returns `true` unconditionally — it never inspects `principal.kind` or `principal.roles`. This is documented, known, and intentional-for-now architecture debt (ADR-0007: "permissive until Phase 2 ... unchanged risk profile"), not something introduced by this audit. The consequence for pricing, though, was real: **before this fix, "authenticated" (of any kind) was sufficient to forge a price**, on both the Cart and Checkout admin surfaces. This audit does not implement real RBAC (out of scope, a Phase-2 item per ADR-0007) — it removes pricing as something _any_ authenticated principal, staff or not, could ever influence, which is the load-bearing fix regardless of how RBAC eventually resolves the staff/customer distinction.

**Classification (Task 5):**

- `cart-routes.ts` / `checkout-routes.ts`: **Authenticated Customer-or-Staff (currently indistinguishable)** — was VULNERABLE for pricing, now FIXED. Object-level access (which cart/session id a caller may act on) remains unrestricted by design of the admin-facade pattern (see §12) — unchanged by this fix, tracked as a separate, pre-existing risk under ADR-0007.

---

## 4. Pricing Data Flow (as found, pre-fix)

```
Cart (admin-authenticated):
  POST /carts/:cartId/items { unitPriceAmountMinor, currency }   [CLIENT-CONTROLLED]
    → CartAdminController.addItem (AdminGuard.ensure — AllowAllAccessControl, no-op)
    → AddItem use case → Money.create(input.unitPriceAmountMinor, input.currency)  [shape-only validation]
    → Cart.addItem(...) → currency-vs-cart-currency check only, NO Pricing check
    → persisted CartItem.unitPrice                                [FORGED VALUE PERSISTED]

Checkout (admin-authenticated), fully independent of any real Cart:
  POST /checkouts { cartRef: <any string, never dereferenced> }
  POST /checkouts/:id/items { items: [{ unitPriceAmountMinor, currency }] }  [CLIENT-CONTROLLED, no linkage to Cart]
    → LoadItems use case → CheckoutItem.create(...)  [shape-only validation: integer, >= 0]
    → CheckoutSession.loadItems(items)                [stored verbatim]
  POST /checkouts/:id/validate
    → ValidateCheckout → PricingValidationPort.validate(items)
    → InMemoryPricingValidationAdapter: `items.every(i => i.unitPriceAmountMinor >= 0)`  [NO-OP STUB — never calls Pricing]
  POST /checkouts/:id/recalculate
    → CheckoutTotals.assemble(items, tax, shipping, discount)   [sum of the forged snapshot]
  GET /checkouts/:id/payment-intent-request
    → amountMinor = totals.totalMinor                            [FORGED AMOUNT HANDED TO PAYMENTS]
```

The design intent (ADR-0012, `PurchaseWorkflow`) is a Temporal saga whose first activity is "price quote (Pricing)" — i.e. the orchestrator itself is supposed to derive `LoadItems`' input from Pricing, not accept it from an HTTP caller. `PurchaseWorkflow` does not exist anywhere in `apps/runtime` — it is documented, not built. `checkout-routes.ts` is, today, the _only_ way a checkout session's items are ever set, and it trusted the caller completely.

`apps/admin/src/composition.ts` wires Checkout via `wireCheckout(deps)` with no override for its 5 orchestration ports — the in-memory stub adapters (`services/checkout/src/infrastructure/in-memory-orchestration-adapters.ts`) are what runs, in this codebase, today, not merely in tests.

---

## 5. Cart Route Audit (Task 2 answers)

1. **Is the authenticated user allowed to choose the price?** No — this was never a documented capability (no doc, ADR, or sprint report states "staff may override price on add-item"); it was the same _absence_ of a fix that H-01 found on the public route, just not yet remediated on the admin one (H-01 report §17 explicitly flagged this and deferred it).
2. **Admin/backoffice or customer-facing?** Named/commented as "merchant-admin operator," but nothing in code enforces that — see §3.
3. **Is authentication alone sufficient trust?** No, but that's exactly what the code did (until this fix) — `AllowAllAccessControl` authorizes on identity alone, not on `kind`.
4. **Does the use case validate against Pricing?** No — `AddItem`/`ReplaceVariant` (`services/cart/src/application/*.ts`) build `Money` directly from caller input; Pricing is never imported.
5. **Does Cart validate anything beyond currency consistency?** No — `Cart.addItem()` only checks `unitPrice.currency === this.props.currency`.
6. **Cheap price?** Proven possible pre-fix (Attack A). Fixed.
7. **Inflated price?** Proven possible pre-fix (Attack B). Fixed.
8. **Currency change?** Proven possible pre-fix (Attack C) by also client-choosing the cart's own currency at creation. Fixed for the pricing dimension (see §6 for the residual cart-creation-currency note, unchanged and pre-existing, same as H-01 §8's own judgment).
9. **Can the resulting cart be submitted to Checkout?** Structurally yes (`cart:checkout` emits `cart.checked_out`), but that event has no consumer wiring today (`grep` found none) — checkout sessions and carts are, today, two entirely disconnected flows at the HTTP layer. Fixed by tying `loadItems` to a real Cart (§9).
10. **Does Checkout trust the stored cart price?** Irrelevant pre-fix, since Checkout never read from Cart at all — it took its own independent, equally-forgeable `items` array. Post-fix: yes, and correctly so, since Cart's own price is now Pricing-authoritative.

---

## 6. Checkout Route Audit (Task 3 answers)

- **Source of product price:** pre-fix, the client (`loadItemsBody.items[].unitPriceAmountMinor`). Post-fix, the named Cart's own stored `CartItem.unitPrice` (itself Pricing-authoritative as of §5's fix).
- **Source of cart line price / currency:** same as above.
- **Source of totals:** `CheckoutTotals.assemble(items, tax, shipping, discount)` — a pure sum of already-stored snapshots; Checkout never queries Pricing directly for a total, by design (it's an orchestration aggregate, not a pricing engine).
- **Is Pricing queried again?** Only via `ValidateCheckout` → `PricingValidationPort`, and that port is a no-op stub in this codebase today (see §4). Not fixed here (see §12) — no longer load-bearing for _this_ vulnerability post-fix, since items are now Cart-derived, but still a dead validation step.
- **Does inventory affect price validation?** No — `InventoryValidationPort` is a separate, equally-stubbed check (`quantity > 0` only).
- **Do discounts/promotions affect price?** `ValidatePromotion` stores whatever `PromotionValidationPort` returns; the in-memory stub always returns `discountMinor: 0`. Not a pricing-forgery vector (the caller doesn't supply the discount amount, only a `promotionRef`), out of scope.
- **Do taxes/shipping affect price?** Both are snapshots requested from ports (`TaxCalculationPort`, `ShippingCalculationPort`) and stored verbatim — `SelectShipping`'s `rateAmountMinor` **is** caller-supplied (`selectShippingBody`), same class of defect in principle, but out of scope for this audit (not one of the two named routes' _item_ pricing, and shipping rate forgery has a much smaller blast radius); flagged in §12 as VULNERABLE-adjacent, not fixed.
- **Does payment amount come directly from Cart?** Post-fix, yes (transitively, via the re-derived `items`). Pre-fix, no — it came directly from the client's own `loadItems` body.
- **Can payment amount originate from client input?** Pre-fix: yes, proven (Attack D). Post-fix: no — `generatePaymentIntentRequest.amountMinor` is `totals.totalMinor`, and `totals` is now always assembled from Cart-derived, Pricing-authoritative items.

**The most important question, answered:** Pre-fix, Checkout was **not** authoritative over the charged amount — it blindly trusted a caller-supplied item array with no linkage to any Cart at all (worse than "trusts a client-controlled Cart snapshot," since it didn't even require a real Cart to exist). Post-fix, Checkout is authoritative in the only sense available in this architecture today (no live Pricing re-query, but a mandatory, non-bypassable derivation from Cart's own already-authoritative price).

---

## 7. Exploit Attempts (Task 4)

All six attack classes were proven with real, in-memory-composed HTTP-route-to-domain-aggregate tests (`apps/admin/src/http/cart-checkout-pricing-security.e2e.test.ts`, first version, run **before** any production code changed) driving the actual `RouteDefinition.handle()` boundary through a real `wireAdmin()` composition — same technique `public-cart-routes.test.ts` used for H-01. Every attack authenticated as `{ id: "customer-attacker", kind: "customer", roles: [] }` — never staff.

| Attack                           | Route                                                                              | Forged input                                                       | Pre-fix result                                                                                                | Post-fix result                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A — cheap price                  | `POST /carts/:cartId/items`                                                        | `unitPriceAmountMinor: 1` (real price 1999)                        | **200, stored at 1**                                                                                          | 200, stored at 1999 (forged value ignored)                                                                                                                               |
| B — inflated price               | `POST /carts/:cartId/items`                                                        | `unitPriceAmountMinor: 999_999_999`                                | **200, stored at 999999999**                                                                                  | 200, stored at 1999                                                                                                                                                      |
| C — currency manipulation        | `POST /carts/:cartId/items`                                                        | cart + item both forged to `"EUR"` (product only published in USD) | **200, stored at 1 EUR**                                                                                      | 409 (currency mismatch against the real USD-resolved price — Cart's pre-existing, unrelated invariant)                                                                   |
| D — checkout manipulation        | `POST /checkouts/:id/items` → `.../recalculate` → `GET .../payment-intent-request` | fully fabricated `items[]`, never tied to any Cart                 | **`payment-intent-request.amountMinor === 1`** (real price 1999)                                              | `amountMinor === 1999`, forged `items[]` body (if smuggled alongside a real `cartId`) silently ignored                                                                   |
| E — cross-user cart manipulation | `POST /carts/:cartId/items` on another customer's cart id                          | attacker principal, victim's `cartId`                              | **200, forged price 1 stored in victim's cart**                                                               | 200 (object-level access unchanged — see §12), but price is always 1999 (authoritative) — the monetary manipulation is closed even though the cart-access breadth is not |
| F — product/price mismatch       | N/A as a distinct vector here                                                      | —                                                                  | Subsumed by A/B: since price was never tied to _any_ product, "mismatch" and "arbitrary" were the same defect | Now impossible — price is always looked up by the specific `productId` given                                                                                             |

Full HTTP status / stored value / calculated total / payment amount for every case is recorded as executable assertions in the test file (12 tests, post-fix version) — not reproduced as prose here to avoid drift from the actual code.

---

## 8. Evidence

- **Pre-fix exploit run:** `pnpm --filter admin exec vitest run src/http/cart-checkout-pricing-security.e2e.test.ts` → **5/5 passed**, each assertion proving the forged value was what got stored/propagated (this was the first version of the file, before any production code changed).
- **Post-fix regression run:** same command, rewritten file → **12/12 passed**, each assertion now proving the forged value is ignored and the real, Pricing-derived value is used instead.
- **Full admin app suite (unaffected routes must still pass):** `pnpm --filter admin exec vitest run` → **97/97 passed across 8 test files**, including the pre-existing `public-cart-routes.test.ts` (H-01's own 29 tests, unmodified in behavior).
- **Full monorepo gates:** see §14.

---

## 9. Root Cause

Same structural root cause as H-01, on a second (and a third, independent) boundary:

1. **Cart admin surface:** `cart-routes.ts`'s `addItemBody`/`replaceVariantBody` Zod schemas declared `unitPriceAmountMinor`/`currency` as accepted client input, passed straight through to `AddItem`/`ReplaceVariant`, which build `Money` directly from them. `Cart`'s domain (`services/cart/src/domain/cart.ts`) is designed to accept a caller-supplied price snapshot ("Pricing/Inventory are never imported... supplied by the caller") — by design, correctly, since H-01 already established the _right_ place to fix this is the HTTP boundary, not the domain. `cart-routes.ts` was simply never given the H-01 treatment.
2. **Checkout surface:** `checkout-routes.ts`'s `loadItemsBody` accepted a fully caller-supplied `items[]` array with no requirement that it correspond to any real Cart. `LoadItems`'s own doc comment ("caller-supplied — from Cart, never fetched here") describes an _intended_ convention that nothing in the code enforced — exactly H-01's own root-cause language ("a convention the API itself never enforced").
3. **The only nominal downstream check** (`ValidateCheckout` → `PricingValidationPort`) is an offline stub that checks shape (`>= 0`), not authenticity, and — critically — is not even mandatory before `recalculateTotals`/`generatePaymentIntentRequest` (no state-machine gate requires a `"valid"` `ValidateCheckout` result first).

Restated as the broken trust chain: `loadItemsBody` (client-controlled) → `LoadItemsInput.items` (passed through verbatim) → `CheckoutItem.create(...)` (shape-only validation) → `CheckoutSession.loadItems()` (stored verbatim, no invariant) → `recalculateTotals()` (sums the forged snapshot) → `generatePaymentIntentRequest()` (hands the sum to Payments as truth).

---

## 10. Remediation

**Minimal, H-01-shaped fix, reusing existing capabilities only — no new Pricing abstraction, no Cart/Checkout/Pricing domain change, no event-contract change:**

1. **New shared helper** `apps/admin/src/http/pricing-resolution.ts` — `resolvePrice()`/`priceUnresolvedResponse()`/`PriceResolution`, extracted verbatim from `public-cart-routes.ts` (Task 7: reuses the _existing_ `ListPrices` use case via `admin.publicReads.prices.list()`, exactly as H-01 established; no new Pricing use case, port, or repository method). This also closes the "duplicate logic" gap H-01's own report flagged in §14 (between these two admin-app files — the separate storefront `PriceBook` duplicate remains out of reach across apps, unchanged, as H-01 judged).
2. **`cart-routes.ts`:** `addItemBody`/`replaceVariantBody` lose `unitPriceAmountMinor`/`currency` and gain `.strict()` (H-01's exact pattern — an out-of-contract field is a hard 422 at the Zod boundary, and the handler never reads it even if invoked directly, bypassing Zod). Both handlers now call `resolvePrice(admin, productId)` and 422 via `priceUnresolvedResponse()` on anything other than `"ok"`.
3. **`checkout-routes.ts`:** `loadItemsBody` changes from `{ items: [...] }` to `{ cartId: string }` (`.strict()`). The handler fetches the named Cart via `admin.publicReads.cart.get({ cartId })` — the same existing, already-wired read `public-cart-routes.ts` uses — and re-derives `LoadItemsInput.items` from that Cart's own stored, now-Pricing-authoritative `CartItem`s. `LoadItems`'s use-case signature and the `CheckoutItem` domain value object are byte-for-byte unchanged; only what the HTTP boundary is willing to accept as the _source_ of items changed.

**Why a public API change was justified for `checkout-routes.ts` (Task 10):** a real, proven vulnerability (§7–8) with the checked-in fix demonstrably closing it. **Every caller identified:** `apps/admin/src/http/admin-routes.ts` (wiring only), and nothing else — `checkout-routes.ts` had **zero existing tests and zero callers anywhere in the repo** (`services/storefront` has no checkout implementation yet; the Temporal `PurchaseWorkflow` referenced by ADR-0012 does not exist in `apps/runtime`). Blast radius of the shape change is provably zero pre-existing callers. `services/checkout`'s own service-level tests (`checkout.e2e.test.ts`, `checkout-session.test.ts`) call the use case directly with its unchanged input shape and were unaffected (see §14).

---

## 11. Regression Tests

`apps/admin/src/http/cart-checkout-pricing-security.e2e.test.ts` — 12 tests, all passing post-fix:

- **Legitimate request** (Cart): real published price used.
- **Attack A (cheap)**, **Attack B (inflated)**: forged values ignored, real price stored.
- **Attack C (currency)**: forged currency can't smuggle a price; cross-currency now correctly 409s via Cart's pre-existing (unrelated) invariant.
- **Unknown product** → 422.
- **Draft (unpublished) price** → 422.
- **Ambiguous price** (two published rows) → 422, never guessed at.
- **Schema-level rejection** (Cart): `.strict()` verified directly against both `addItemBody` and `replaceVariantBody`.
- **Cross-cart access**: documents, explicitly, that object-level cart access is unchanged (still permitted) while the price is now always authoritative regardless of which cart is touched — see §12 for why this isn't "fixed."
- **Legitimate flow** (Checkout): `payment-intent-request.amountMinor` matches the real Cart total (quantity × real price).
- **Attack D**: a smuggled, Zod-bypassing forged `items[]` alongside a real `cartId` is silently ignored; the payment-intent amount is the real total.
- **Schema-level rejection** (Checkout): a raw `items[]` body fails `.strict()`; `{ cartId }` is the only accepted shape.

Not added (and why): a dedicated "tenant isolation" test — `tenant-guard.e2e.test.ts` already covers tenant isolation generically for the admin transport, and neither fix touched tenant resolution.

---

## 12. Remaining Risks

1. **ADR-0007's RBAC seam is still permissive** (`AllowAllAccessControl`, Phase 2 not yet wired). This fix removes pricing as something any authenticated principal could influence; it does **not** make `cart-routes.ts`/`checkout-routes.ts` staff-only. Tracked as pre-existing, documented debt — not introduced or worsened here.
2. **Cross-cart / cross-session object-level access on `cart-routes.ts` is unchanged.** No route in this file ties `cartId` to the caller's own identity (unlike `public-cart-routes.ts`'s `requireOwnedCart`) — this appears to be an intentional admin-facade characteristic (staff acting on any customer's resources, same pattern as order refunds/mark-paid elsewhere in the admin surface), not a monetary defect on its own, and is out of this audit's proven-vulnerability scope. If Phase 2 RBAC does _not_ end up restricting this surface to staff, this becomes a live OWASP API #1 (BOLA) finding independent of pricing.
3. **`checkout-routes.ts`'s `POST /checkouts` still accepts a free-text `cartRef`** never verified to reference a real Cart at session-start time. Not a monetary vector on its own (Checkout only ever reads real Cart data once `loadItems` runs, and that now requires the _actual_ `cartId`), flagged for completeness.
4. **`ValidateCheckout`'s `PricingValidationPort` is still a no-op stub** (`amount >= 0` only) — no longer load-bearing for the vulnerability this audit closed, but still a misleading "validation" step that always reports success. Fixing it for real requires wiring Checkout's orchestration ports to real Pricing/Inventory/Finance/Shipping/Promotions adapters, explicitly a Phase-2/ADR-0012 `PurchaseWorkflow` concern — out of scope for a "smallest safe remediation."
5. **`checkout-routes.ts`'s `SelectShipping.rateAmountMinor` remains caller-supplied**, same class of defect in principle (a snapshot the client asserts rather than one Checkout re-derives), smaller blast radius (shipping rate, not item price), not fixed here — flagged for a future, separately-scoped pass.
6. **`POST /carts` (both public and admin) still accepts a client-chosen cart `currency`** — unchanged, same reasoning H-01 §8 already gave (doesn't set any item's price; a mismatch now cleanly 409s rather than being exploitable).
7. **`apps/admin/src/http/payments-routes.ts`'s `POST /payment-intents` (`amountMinor`) and `returns-routes.ts`'s resolution `amountMinor`** are caller-supplied monetary inputs on a _different_ context's admin surface, gated by the same permissive `AccessControl`. Payments is architecturally a downstream sink (it cannot independently know the "correct" amount — that's its caller's job), so this is not automatically the same defect class as Cart/Checkout item pricing, but it was not audited in depth here (different files, different context, explicitly out of this task's scope — "DO NOT modify unrelated modules"). Flagged for a separate, dedicated review.

---

## 13. Remaining Client-Controlled Monetary Inputs (repository-wide sweep, Task 12)

| Endpoint                                             | Monetary Input                                           | Client Controlled                | Authoritative Validation                                            | Risk                                                                                      | Verdict                       |
| ---------------------------------------------------- | -------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| `POST /public/carts/:cartId/items`                   | `unitPriceAmountMinor`/`currency`                        | No (H-01, resolved server-side)  | `resolvePrice()` → Pricing `ListPrices`                             | —                                                                                         | SAFE                          |
| `POST /carts/:cartId/items` (admin)                  | `unitPriceAmountMinor`/`currency`                        | **No, as of this fix** (was Yes) | `resolvePrice()` → Pricing `ListPrices` (shared helper)             | —                                                                                         | **FIXED**                     |
| `POST /carts/:cartId/items/replace` (admin)          | `unitPriceAmountMinor`/`currency`                        | **No, as of this fix** (was Yes) | same as above, keyed on `newProductId`                              | —                                                                                         | **FIXED**                     |
| `POST /checkouts/:id/items` (admin)                  | previously raw `items[].unitPriceAmountMinor`/`currency` | **No, as of this fix** (was Yes) | Re-derived from the named Cart's own (now-authoritative) items      | —                                                                                         | **FIXED**                     |
| `POST /checkouts/:id/shipping-selection`             | `rateAmountMinor`                                        | Yes                              | None (stored verbatim)                                              | Medium — smaller blast radius than item price, no live exploit demonstrated in this audit | OUT OF SCOPE (flagged, §12.5) |
| `POST /carts` / `POST /public/carts`                 | cart `currency`                                          | Yes                              | None (doesn't set any price; mismatch now 409s)                     | Low, pre-existing, judged safe by H-01                                                    | SAFE (documented)             |
| `POST /payment-intents` (admin, Payments)            | `amountMinor`/`currency`                                 | Yes                              | None visible at this layer; Payments is a downstream sink by design | Unclear without a dedicated Payments-context audit                                        | OUT OF SCOPE (flagged, §12.7) |
| `POST /payment-intents/:id/refund` (admin, Payments) | `amountMinor`/`currency`                                 | Yes                              | Not audited here                                                    | Unclear                                                                                   | OUT OF SCOPE (flagged, §12.7) |
| `POST /returns/:id/resolution` (admin, Returns)      | `amountMinor` (optional)                                 | Yes                              | Not audited here                                                    | Low-Medium (staff refund-amount decision, plausibly intentional)                          | OUT OF SCOPE (flagged, §12.7) |
| `GET /public/prices`, catalog DTOs                   | `amountMinor` fields                                     | N/A — read-only projections      | N/A                                                                 | None                                                                                      | SAFE                          |

---

## 14. Quality Gates

Run against the real repository, not fabricated:

```text
pnpm run typecheck   → 78/78 packages successful (turbo)
pnpm run test        → 78/78 packages successful (turbo) — includes services/checkout's
                        own unaffected service-level tests and the new 12-test regression file
pnpm run lint         → 78/78 packages successful (turbo)
pnpm run arch (depcruise packages services) → 0 violations, 1564 modules / 6782 dependencies
pnpm governance       → does NOT exist in this repo (no such script anywhere; verified, not assumed)
pnpm dup              → does NOT exist in this repo (no duplication-detection tooling)
```

Targeted runs:

```text
pnpm --filter admin exec vitest run
  → 97/97 passed, 8 test files (includes the new file and the untouched public-cart-routes.test.ts)
pnpm --filter admin exec tsc --noEmit -p .
  → clean
```

`services/cart`, `services/pricing`, `services/checkout` have no dedicated top-level script beyond the standard `typecheck`/`test`/`lint` already covered by the turbo runs above; `apps/storefront` was typechecked/tested as part of the same turbo run (unaffected — no checkout implementation exists there yet to be affected).

---

## 15. Environment Limitations

Live verification (real Postgres-backed Cart/Pricing/Checkout, a real Fastify Zod pipeline end-to-end) was **not attempted**, consistent with every prior session in this project (`[[morbeh-integration-verification-sprint]]`, `[[morbeh-dashboard-orders-phase1-1-verification]]`, H-01's own §16) — Docker Desktop and WSL2 have been confirmed broken in this sandbox across multiple prior sessions.

- **PROVEN BY TESTS / PROVEN IN-MEMORY:** the entire exploit-then-fix chain (§7, §11) — real `wireAdmin()` composition, real `AddItem`/`ReplaceVariant`/`LoadItems`/`RecalculateTotals`/`GeneratePaymentIntentRequest` use cases, real in-memory `Cart`/`CheckoutSession`/`Price` repositories and domain invariants, driven through the actual `RouteDefinition.handle()` boundary.
- **PROVEN LIVE:** nothing — no live-stack run was possible.
- **NOT VERIFIED:** real Postgres persistence path for the changed routes (both `cart-routes.ts`/`checkout-routes.ts` support a Prisma-backed branch via `wireCart`/`wireCheckout({ prisma, tenantId })`, untouched by this fix's logic, but not exercised live here); a real Fastify HTTP round-trip through `createAdminHttpApi` with a genuine JWT (the in-memory `route.handle()` technique bypasses Fastify/Zod deliberately, matching this repo's own established H-01 testing convention, but is not the same as an HTTP round-trip).
- **ENVIRONMENT BLOCKED:** Docker Desktop and WSL2, as in every prior session.

---

## 16. Final Security Verdict

### FIXED

A real, exploitable vulnerability existed on both audited surfaces — proven with executable exploit tests against the real (in-memory) composition before any code changed — and has been remediated with the smallest change consistent with this codebase's own H-01 precedent, then regression-tested (12 tests, all passing) alongside the full existing suite (97/97 admin-app tests, 78/78 packages typecheck/lint/test, 0 architecture violations).

This is **not** "conditionally production-ready" due to environmental verification gaps alone (§15) — the code-level fix is proven correct by tests, independent of live-stack availability. It **is** conditioned on the residual risks in §12 remaining tracked: object-level cart access (BOLA) is unchanged, Checkout's `PricingValidationPort` is still a no-op stub (no longer load-bearing for _this_ defect, but still misleading), and shipping-rate forgery plus the Payments/Returns admin surfaces were flagged but not audited in depth (out of this task's scope).

---

## 17. Files Changed

**`apps/admin`:**

- `src/http/pricing-resolution.ts` — **NEW.** Shared `resolvePrice()`/`priceUnresolvedResponse()`/`PriceResolution`, extracted from `public-cart-routes.ts`.
- `src/http/public-cart-routes.ts` — now imports the shared helper instead of defining it locally; behavior unchanged (verified: existing 29 H-01 tests still pass unmodified).
- `src/http/cart-routes.ts` — `addItemBody`/`replaceVariantBody` lose `unitPriceAmountMinor`/`currency`, gain `.strict()`; both handlers resolve price server-side before delegating.
- `src/http/checkout-routes.ts` — `loadItemsBody` changes from `{ items }` to `{ cartId }` (`.strict()`); handler re-derives items from the named Cart via the existing `admin.publicReads.cart.get()`.
- `src/http/cart-checkout-pricing-security.e2e.test.ts` — **NEW.** 12 regression tests (rewritten from an initial 5-test exploit-proof version run against pre-fix code).

**No changes** to `services/cart`, `services/checkout`, `services/pricing` (domain, application, event contracts, or use-case signatures), or to any other app/service. Nothing was committed, per this repo's sprint-isolation discipline and this task's own instruction.
