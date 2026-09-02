# Phase 17.1 — Guest Cart Security Remediation (H-01)

**Status:** H-01 CLOSED for the scope defined below. **Not committed to git**, per this repo's standing sprint-isolation discipline — every file below is modified in the working tree only.

---

## 1. Executive Summary

A security audit of Phase 17.1 (Guest Cart Foundation) identified **H-01**: the public, unauthenticated `POST /public/carts/:cartId/items` route accepted `unitPriceAmountMinor` and `currency` directly from the request body and stored them verbatim as the cart line's price. The storefront's own Server Action resolved the real price server-side before calling this route, but that was a convention the API itself never enforced — any caller who could reach the Runtime Gateway directly (not just through the storefront) could set an arbitrary price on a real product.

The fix removes `unitPriceAmountMinor`/`currency` from the public add-item contract entirely and resolves the authoritative price server-side, in-process, from Pricing's own published-price data — reusing the exact resolution semantics the storefront's `PriceBook` already established, rather than inventing a new pricing mechanism. The Cart aggregate, its use cases, its event contracts, and the admin-authenticated Cart surface are all unchanged. All quality gates pass; 8 new regression tests prove the tampering vector is closed.

**Verdict: CONDITIONALLY PRODUCTION READY** — see §19.

---

## 2. H-01 Root Cause

`apps/admin/src/http/public-cart-routes.ts`'s `addItemBody` Zod schema declared `unitPriceAmountMinor: z.number().int().positive()` and `currency: z.string().length(3)` as accepted, non-optional client input. The route handler passed both straight through to `AddItem` (`services/cart/src/application/add-item.use-case.ts`), which builds a `Money` value object directly from them — `Money.create` only validates shape (a positive integer, a plausible currency string), not correctness against any price source. The `Cart` aggregate (`services/cart/src/domain/cart.ts`) requires a `Money unitPrice` as a caller-supplied parameter **by design** ("Pricing/Inventory are never imported: products are referenced by id and the unit price/availability are supplied by the caller") and enforces only that the item's currency matches the cart's own currency — never that the amount is legitimate. Nothing between the HTTP boundary and the persisted cart line re-derived or verified the price.

## 3. Attack Scenario

```text
Attacker (or anyone who can reach the Runtime Gateway directly, not just via the storefront)
  ↓
POST /public/carts/:cartId/items
  { sessionRef: "<their own real guest session>", productId: "product-1",
    quantity: 1, unitPriceAmountMinor: 1, currency: "USD" }
  ↓
requireOwnedCart passes — the attacker legitimately owns this cart (ownership was never the gap)
  ↓
AddItem builds Money(1, "USD") with no reference to Pricing at all
  ↓
Cart item persisted at 1 minor unit for a real, normally-priced product
```

**Impact:** commercial — a shopper could check out (once checkout is wired) or otherwise persist a cart priced arbitrarily below (or above) the product's real price, entirely within their own legitimately-owned guest cart. Ownership enforcement (`requireOwnedCart`) was already correct and irrelevant to this defect — the attacker never needed anyone else's cart.

## 4. Root Cause

See §2. Restated as the trust chain that had to be broken: `addItemBody` (client-controlled) → `AddItemInput` (passed through verbatim) → `Money.create(input.unitPriceAmountMinor, input.currency)` (shape-only validation) → `Cart.addItem(..., unitPrice: Money, ...)` (currency-vs-cart-currency check only) → persisted line.

## 5. Fix

`unitPriceAmountMinor`/`currency` were removed from `addItemBody` entirely, and the schema was made `.strict()` so a request that still carries them fails Zod validation (422) rather than having the fields silently stripped. The route handler no longer reads either field off `body` under any circumstance — including when a test or a caller invokes the handler directly, bypassing Zod (this repo's own test harness does exactly that; see §12). Immediately after the existing ownership check (`requireOwnedCart`, unchanged), the handler calls a new `resolvePrice(admin, productId)` helper that:

1. Lists prices via `admin.publicReads.prices.list({ first: 100 })` — the **existing** `ListPrices` use case (`services/pricing`), already wired into `WiredAdmin.publicReads` for the public catalog routes; no new Pricing use case, port, or repository method was added.
2. Filters to `status === "published"` rows matching the requested `productId`.
3. Returns `"ok"` (with the resolved amount/currency) for exactly one match, `"unavailable"` for zero, `"ambiguous"` for more than one, `"error"` if the list call itself failed.

This mirrors — deliberately, field-for-field — the resolution semantics the storefront's own `PriceBook.resolve()` (`apps/storefront/src/lib/catalog.ts`) already implements, including its `first: 100` page-size ceiling (a disclosed, pre-existing limitation, not a new one) and its "ambiguous" state for the case where Pricing has no invariant preventing two concurrently-published prices on one product. No dedicated "resolve effective price" use case existed anywhere in Pricing before this fix, and none was added — `ListPrices` (a plain cursor list) was the only existing read capability, and Task 2's own instructions anticipated this exact situation ("if only a read API exists, determine whether it is safe... to reuse from the public Cart route").

A non-`"ok"` resolution short-circuits to a 422 (`ValidationError`, the codebase's existing convention for "this request cannot be fulfilled as submitted" — `STATUS_BY_CODE.VALIDATION`) before `Cart.add()` is ever called, so no cart item is created. An `"ok"` resolution is passed into the **unchanged** `admin.publicReads.cart.add(...)` call exactly where the client's value used to go.

## 6. New HTTP Contract

Before:

```json
POST /public/carts/:cartId/items
{ "sessionRef": "...", "productId": "...", "quantity": 1, "unitPriceAmountMinor": 1999, "currency": "USD" }
```

After:

```json
POST /public/carts/:cartId/items
{ "sessionRef": "...", "productId": "...", "quantity": 1 }
```

(`inventoryAvailable`/`metadata` remain optional and unchanged — out of scope for H-01, see §17.) A request that still includes `unitPriceAmountMinor` or `currency` is rejected at the Zod boundary with 422 (`.strict()`), and even if it reached the handler directly, those fields are never read.

## 7. Price Resolution Flow

```text
productId (client-supplied, validated for shape only)
   ↓
resolvePrice(): admin.publicReads.prices.list({ first: 100 })  — existing ListPrices use case
   ↓
filter: status === "published" AND product.value === productId
   ↓
0 matches → "unavailable"   >1 match → "ambiguous"   1 match → "ok" { amountMinor, currency }
   ↓ (only on "ok")
admin.publicReads.cart.add({ ..., unitPriceAmountMinor: resolved, currency: resolved })  — existing AddItem use case, unchanged
```

## 8. Currency Integrity

No new code was needed to enforce `Cart.currency === resolvedPrice.currency` — `Cart.addItem()` (`services/cart/src/domain/cart.ts:72-74`) already throws `BusinessRuleError` when the item's currency doesn't match the cart's, and `AddItem`'s use case already catches domain errors and returns them as a `Result`, which `present()` maps to HTTP 409. Since the price now always comes from Pricing rather than the client, this pre-existing guard is now load-bearing in a way it wasn't before: a cart created in `USD` that resolves a product priced only in `EUR` gets a clean 409, the cart is left untouched, and no new error taxonomy was introduced. Verified in a new test (§12).

One deliberate scope boundary: `POST /public/carts` (cart creation) still accepts a client-chosen `currency` for the new cart. This is unchanged and was judged out of scope — it doesn't set any item's price, and post-fix, a mismatched currency on add-item simply 409s rather than being exploitable for underpricing. Expanding H-01's fix to cart-creation currency would have gone beyond the demonstrated defect.

## 9. Ownership Security

`requireOwnedCart` (unchanged) still runs first on every mutation, including add-item — it was never the gap (see §3). All pre-existing ownership tests (session-B-cannot-touch-session-A's-cart, forged session, empty sessionRef, unknown-vs-cross-owned 404 identity, tenant isolation) were re-run against the changed route and still pass unmodified in behavior (only re-seeded with a `WiredPricing` fixture where a test path reaches price resolution).

## 10. Session Security

Unchanged and out of scope for H-01 — `sessionRef` is still server-issued in the storefront's Next.js layer (`HttpOnly`, `SameSite=Lax`, `apps/storefront/src/lib/cart.ts`), never accepted from a browser directly, and the guest session model was not touched.

## 11. Mass Assignment Audit

| Field                  | Before H-01                                                     | After H-01                                                               |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `unitPriceAmountMinor` | accepted, trusted verbatim                                      | **not accepted** — `.strict()` schema rejects it; handler never reads it |
| `currency`             | accepted, trusted verbatim                                      | **not accepted** — same                                                  |
| `sessionRef`           | server-derived by the storefront, checked by `requireOwnedCart` | unchanged                                                                |
| `customerRef`          | never accepted on any guest mutation route                      | unchanged (pre-existing regression test still passes)                    |
| `tenantId`             | never accepted; resolved from `x-tenant-id`/pipeline            | unchanged                                                                |
| `status`               | never accepted on any guest route                               | unchanged                                                                |

The fix does not rely solely on Zod's default key-stripping: `.strict()` makes an out-of-contract field a hard validation failure, and the handler's own logic ignores `body.unitPriceAmountMinor`/`body.currency` unconditionally — verified directly (not just via the Fastify layer) since this repo's test harness drives `route.handle()` without Zod in the loop.

## 12. Regression Tests

All added to `apps/admin/src/http/public-cart-routes.test.ts` (rewritten test file, 29 tests total, up from 16):

- **Legitimate flow**: `productId` + `quantity` resolves the real seeded published price; asserts against the fixture's own seeded amount, not a hardcoded literal.
- **Tampering, single case**: a request carrying `unitPriceAmountMinor: 1, currency: "USD"` on a product really priced at 1999 results in a cart item priced at 1999, never 1.
- **Tampering, parametrized**: `unitPriceAmountMinor` of `0`, `1`, `999999999` — none influence the resulting item (`it.each`).
- **Tampering, currency**: `currency` of `"EUR"`, `"GBP"` — neither overrides the resolved `"USD"` (`it.each`).
- **Schema-level rejection**: `addItemBody.safeParse(...)` with the old price fields present returns `success: false` (`.strict()` verified directly against the route's own exposed schema).
- **Schema-level acceptance**: the legitimate shape (`sessionRef`/`productId`/`quantity` only) still parses successfully.
- **No price** → 422, cart left with zero items (verified by re-reading the cart).
- **Draft (unpublished) price** → treated the same as no price → 422.
- **Ambiguous** (two published prices for one product) → 422, never guessed at.
- **Currency mismatch** (cart in USD, resolved price in EUR) → 409 via the existing `BusinessRuleError` path, cart left untouched.

Every pre-existing test (route inventory, full lifecycle, ownership matrix, customerRef-spoof, tenant isolation, DTO boundary) was re-run and passes; the ones that exercise add-item now seed a real published `Price` first via a new `seedPublishedPrice()` helper (which goes through `wirePricing`'s own `create`/`publish` use cases — never fabricated repository state).

## 13. Architecture Findings

Dependency direction is unchanged: `HTTP (apps/admin) → Application (services/cart, services/pricing) → Domain`. The fix adds exactly one new in-process call from the HTTP route to Pricing's already-wired `PriceController.list()` — the same `admin.publicReads.prices` controller `public-catalog-routes.ts` already calls for `GET /public/prices`. No `Domain → HTTP/Storefront/Admin` edge was introduced. `Cart`'s domain layer still imports nothing from Pricing — the resolved price crosses into Cart only as a plain `Money` value, exactly as it did before, just sourced server-side instead of from the client. `pnpm run arch` (dependency-cruiser over `packages`+`services`) reports 0 violations across 1564 modules / 6782 dependencies after the change.

## 14. Duplicate Logic Findings

The "published, exactly-one-match, else unavailable/ambiguous" resolution algorithm now exists in two places: `apps/storefront/src/lib/catalog.ts`'s `PriceBook` (client-adjacent, used for the storefront's own fast-fail UX and to pick a new cart's initial currency) and `apps/admin/src/http/public-cart-routes.ts`'s `resolvePrice` (server-authoritative, used to price the cart line). These are two different apps in this monorepo (`apps/admin` cannot import from `apps/storefront`, nor should it — different deployables, different trust boundaries) with no existing shared package positioned to hold this logic. Moving it into `services/pricing` as a new use case was considered and rejected as scope creep beyond a demonstrated defect (Task 13's own instruction: "do NOT create abstractions merely to satisfy DRY... avoid architectural over-engineering"); the duplication is ~15 lines, doesn't touch persistence, and both copies now assert the same behavior in tests. Flagged here, not fixed, per that same instruction.

No duplication was introduced in ownership checks, session extraction, cart lookup, or cart mutation orchestration — none of those were touched.

## 15. Quality Gates

Run against the real repository, not fabricated:

```text
pnpm turbo run typecheck   → 78/78 packages successful
pnpm turbo run test        → 78/78 packages successful (includes the 29 rewritten Cart route tests)
pnpm turbo run lint        → 78/78 packages successful
pnpm run arch (depcruise)  → 0 violations, 1564 modules / 6782 dependencies
pnpm governance            → does NOT exist in this repo (no such script anywhere)
pnpm dup                   → does NOT exist in this repo (no duplication-detection tooling)
```

## 16. Browser Verification

**NOT TESTED.** This remediation is a server-side HTTP contract + resolution-logic change with no rendering surface of its own; per this task's own `<when_to_verify>` guidance, browser verification is warranted only when a change is observable through the running app. Live end-to-end verification (real storefront → real Runtime Gateway → real Postgres) was not attempted because — consistent with this project's prior sessions (see `[[lumo-integration-verification-sprint]]` / `[[lumo-dashboard-orders-phase1-1-verification]]` in memory) — Docker Desktop and WSL2 have both been confirmed broken in this sandbox in earlier sessions and were not re-attempted here. All verification above is **PROVEN** at the offline level (typecheck/test/lint/arch, including a full in-process HTTP-route-to-domain-aggregate regression suite); live-stack behavior (real Postgres-backed Cart/Pricing, real Fastify Zod pipeline end to end, real cookie round-trip through a running Next.js dev server) is **BLOCKED**, not fabricated as passing.

## 17. Remaining Risks

- `apps/admin/src/http/cart-routes.ts` (the **admin-authenticated** Cart surface, `cart:add_item` permission required) still accepts client-supplied `unitPriceAmountMinor`/`currency` on both its add-item and replace-variant routes, as does `services/cart/src/application/replace-variant.use-case.ts`. This is a different trust boundary (an authenticated merchant-admin operator, not an anonymous shopper) and was explicitly out of H-01's scope ("the raw **public** Cart HTTP add-item route"). Not changed here; flagged for awareness, not treated as part of this remediation.
- `POST /public/carts`'s client-chosen `currency` at cart creation (§8) is unchanged — judged safe post-fix (no longer exploitable for underpricing) but is technically still client-supplied state on a public route.
- `resolvePrice`'s `first: 100` ceiling means a catalog with more than 100 published prices could see legitimate products resolve as `"unavailable"` — an inherited, pre-existing, disclosed limitation (same one `PriceBook.load()` already has), not introduced by this fix.
- No live-stack (Postgres/Docker) verification was possible in this sandbox (§16).

## 18. Files Changed

**`apps/admin`**:

- `src/http/public-cart-routes.ts` — `addItemBody` loses `unitPriceAmountMinor`/`currency`, gains `.strict()`; new `resolvePrice`/`priceUnresolvedResponse`; add-item handler resolves price server-side instead of trusting the body
- `src/http/public-cart-routes.test.ts` — rewritten: 29 tests (was 16), seeds real published `Price` fixtures via `wirePricing`, adds the H-01 regression suite (§12)

**`apps/storefront`**:

- `src/lib/runtime-api.ts` — `AddCartItemInput` loses `unitPriceAmountMinor`/`currency`
- `src/app/cart/actions.ts` — `addToCart` no longer sends `unitPriceAmountMinor`/`currency` to the Cart API (still uses `PriceBook` for its own fast-fail availability check and the new cart's initial currency)

No changes to `services/cart` or `services/pricing` — the Cart aggregate, its use cases, its event contracts, and Pricing's domain/application layers are untouched, as the Absolute Constraints required.

## 19. Production Readiness Verdict

**CONDITIONALLY PRODUCTION READY.**

Proven:

- The client cannot control price or currency on the public add-item route (schema-level and handler-level, both verified).
- Ownership checks are enforced on every cart mutation, unchanged and re-verified.
- Tenant isolation is preserved, unchanged and re-verified.
- No authoritative mass-assignment vulnerability remains on the public Cart surface (§11).
- All regression tests pass; all offline quality gates (typecheck/test/lint/arch) pass.

Not proven (environmental, not a code-level gap):

- Live Postgres/Fastify/Next.js end-to-end verification was blocked by this sandbox's broken Docker/WSL2 stack (§16), consistent with prior sessions in this project.

The demonstrated H-01 vulnerability is closed. The remaining gap is verification-environment availability, not an unresolved security defect — hence conditional, not unqualified, readiness.
