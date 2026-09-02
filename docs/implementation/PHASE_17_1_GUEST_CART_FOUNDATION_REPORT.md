# Phase 17.1 — Guest Cart Foundation

**Status:** COMPLETE for the scope defined below. **Not committed to git** (see §2 and §19) — every file listed in §2 is created/modified in the working tree only, per this repo's standing sprint-isolation discipline (no sprint stages or commits on its own initiative; huge pre-existing uncommitted work already sits in this checkout, predating this phase, and none of it was touched).

---

## 1. Architecture findings

Phase 17 (read-only audit, prior work) established that the Cart aggregate already carries the exact shape a guest/session model needs: mandatory `sessionRef` (present on guest **and** customer carts alike), optional `customerRef`, `assignCustomer()`, `merge()`. Re-verified directly against `services/cart/src/domain/cart.ts` before writing any code — no redesign was needed or performed.

The actual gap was entirely in the **transport/session/ownership layer**:

- `CartRepository` (`services/cart/src/domain/cart-repository.ts`) had only `save`/`findById` — no way to look up "the current cart for this session" at all.
- `apps/admin/src/http/public-cart-routes.ts` (Productization Phase 3) exposed exactly one route, `GET /public/carts/:cartId`, explicitly documented as "read-only by construction... will never grow a write route" — because no customer-facing write transport/auth model existed. It also had **zero ownership enforcement**: any caller who knew (or guessed) a `cartId` could read it, protected only by tenant scoping and UUID unguessability.
- The storefront had **no cart-creation flow, no mutation UI, and no session cookie** at all. `apps/storefront/src/lib/cart.ts` stored a raw `cartId` in a cookie (`CART_COOKIE`) that was declared but never actually written by anything, with a `?cartId=` query param as the only reachable path — neither carried any ownership semantics.
- `packages/http` (the Fastify transport) has **no cookie plugin and no header-setting capability** on `TransportResponse` — a route handler cannot `Set-Cookie`. This is the reason the guest session is issued and held by the **Next.js storefront**, not the Runtime API: Next.js Server Actions/Server Components are the only layer in this stack that can read/write an HttpOnly cookie, and the storefront is already the sole caller of the Runtime API's public routes (never the raw browser).
- The RBAC contract (`Permission = string`, `authorize(principal, permission)`) has no concept of resource ownership — confirmed by reading `packages/contracts/src/{access-control,permission,principal}.ts`. Ownership had to be enforced as an independent check at the Cart HTTP boundary, not bolted onto RBAC.
- Pricing: the Product/Collection pages already resolve authoritative price via `PriceBook` (`apps/storefront/src/lib/catalog.ts`), which reads Pricing's own published-price snapshot — **not** Catalog's embedded `variant.priceAmountMinor`. The guest add-to-cart flow reuses this exact mechanism rather than inventing a second one, which is also how the constraint "do not use Catalog's embedded variant price" is satisfied.

No ADR was required. No new bounded context was introduced. No Cart aggregate change was needed.

---

## 2. Files changed

Everything below is a genuine Phase 17.1 change. (`git status` on this checkout shows ~150 additional modified/untracked files across `apps/storefront` and elsewhere that **predate this session** — e.g. the entire Storefront app was already uncommitted before this phase started. None of those are listed here, and none were touched.)

**`services/cart`** (repository port + application layer):

- `src/domain/cart-repository.ts` — added `findBySessionRef`
- `src/infrastructure/prisma-cart-repository.ts` — implemented `findBySessionRef` (most-recently-updated active row)
- `src/infrastructure/in-memory-cart-repository.ts` — implemented `findBySessionRef` (last-matching in insertion order)
- `src/infrastructure/in-memory-cart-repository.test.ts` — **new**
- `src/infrastructure/cached-cart-repository.ts` — added `findBySessionRef` (deliberate uncached passthrough)
- `src/infrastructure/cached-cart-repository.test.ts` — added passthrough test + repo-fake fix
- `src/application/get-current-cart.use-case.ts` — **new**
- `src/application/get-current-cart.use-case.test.ts` — **new**
- `src/application/get-cart.use-case.test.ts` — fixed inline `CartRepository` fakes for the new interface method
- `src/interfaces/cart.controller.ts` — added `getCurrent`
- `src/composition.ts` — wired `GetCurrentCart`

**`apps/admin`** (public HTTP surface):

- `src/http/public-cart-routes.ts` — rewritten: 7 routes (was 1)
- `src/http/public-cart-routes.test.ts` — rewritten: 16 tests (was 5)

**`apps/storefront`**:

- `src/lib/runtime-api.ts` — removed `getCart(cartId)`; added `getCurrentCart`, `createCart`, `addCartItem`, `changeCartItemQuantity`, `removeCartItem`, `clearCart`
- `src/lib/cart.ts` — rewritten around `resolveCurrentCart`; new `GUEST_SESSION_COOKIE`/`GUEST_SESSION_COOKIE_OPTIONS`
- `src/lib/cart.test.ts` — rewritten
- `src/app/cart/actions.ts` — **new** (Server Actions: `addToCart`, `changeQuantity`, `removeItem`, `clearCart`)
- `src/app/cart/page.tsx` — session-cookie-driven, no `?cartId=`
- `src/components/cart-view.tsx` — now a Client Component with quantity/remove/clear controls
- `src/components/cart-view.test.tsx` — rewritten
- `src/components/add-to-cart-button.tsx` — **new**
- `src/components/add-to-cart-button.test.tsx` — **new**
- `src/components/product-card.tsx` — restructured (Link no longer wraps the whole card; add-to-cart button added)
- `src/components/product-card.test.tsx` — rewritten
- `src/app/products/[slug]/page.tsx` — wired `AddToCartButton`
- `src/messages/en.ts`, `src/messages/ar.ts` — new cart/product-mutation copy; removed the now-dead `quantityLabel` key

27 files total: 11 in `services/cart`, 2 in `apps/admin`, 14 in `apps/storefront`.

---

## 3. Guest-session design

- **Identity**: an opaque `crypto.randomUUID()`, generated in `app/cart/actions.ts` (a `"use server"` module) the first time a mutation needs one — never on a bare page view.
- **Held by**: the Next.js storefront only. The Runtime API (Fastify, `apps/admin`) has no cookie plugin and cannot `Set-Cookie`; giving the storefront sole custody of the cookie avoided any change to `packages/http`.
- **Flows to the Runtime API as**: a `sessionRef` field in the request body/query — read server-side from the cookie by a Server Action or Server Component, **never** supplied by the browser. The browser never sees or chooses this value; `document.cookie` cannot read it (HttpOnly).
- **Current-cart resolution**: `GET /public/carts/current?sessionRef=...` — session exists but no cart yet, or no session cookie at all, both resolve to a clean empty state without creating anything.

---

## 4. Cookie security properties

`GUEST_SESSION_COOKIE_OPTIONS` (`apps/storefront/src/lib/cart.ts`):

| Property   | Value                                 | Why                                                                                                                      |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Name       | `lumo-storefront-guest-session`       | New — the old `CART_COOKIE` (`lumo-storefront-cart-id`) stored a bare cart id with no ownership semantics and is removed |
| `httpOnly` | `true`                                | Client JS can never read or forge it — verified live: `document.cookie` returned `""` after a real add-to-cart           |
| `secure`   | `true` in production, `false` locally | A plain-HTTP local dev server can't set a cookie the browser will accept back if `Secure` is forced on                   |
| `sameSite` | `"lax"`                               | Matches the existing `LOCALE_COOKIE` convention; blocks cross-site POSTs, doesn't break normal top-level navigation      |
| `path`     | `"/"`                                 | Whole app                                                                                                                |
| `maxAge`   | 30 days                               | Bounded lifetime, not a session-only cookie — an abandoned cart survives a browser restart                               |
| Value      | `crypto.randomUUID()`                 | Opaque, unguessable, generated server-side only                                                                          |

No customer identity, no PII, no encoded claims — just the opaque id.

---

## 5. Public route contract

`apps/admin/src/http/public-cart-routes.ts`, all `public: true`, all under `/api/v1/public/carts`:

| Route                                       | Purpose                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `POST /public/carts`                        | Create a guest cart (`sessionRef`, `currency` — no `customerRef` field exists in the schema)                         |
| `GET /public/carts/current?sessionRef=`     | The caller's current active cart, or `{cart: null}`                                                                  |
| `GET /public/carts/:cartId?sessionRef=`     | Read one cart — **now ownership-checked** (see §9, this is a deliberate hardening of the pre-existing Phase 3 route) |
| `POST /public/carts/:cartId/items`          | Add item                                                                                                             |
| `POST /public/carts/:cartId/items/quantity` | Change quantity                                                                                                      |
| `POST /public/carts/:cartId/items/remove`   | Remove item                                                                                                          |
| `POST /public/carts/:cartId/clear`          | Clear cart                                                                                                           |

Every route reuses the existing `CartController`/use cases verbatim (`admin.publicReads.cart`, already wired in `composition.ts` since Phase 3) — zero new composition-root wiring. `lock`/`unlock`/`checkout`/`expire`/`abandon`/`save`/`restore`/`merge`/`replaceVariant`/`assignCustomer` are **not** exposed; they remain admin-only (`cart-routes.ts`).

---

## 6. Ownership enforcement design

One helper, `requireOwnedCart(admin, cartId, sessionRef)`, used by every read/mutation route:

1. Loads the cart via the same unguarded `CartController.get()` every route already had.
2. A non-2xx response (unknown cart) passes through unchanged (404).
3. `cart.sessionRef !== sessionRef` → the **identical** 404 envelope an unknown cart returns (`notFoundResponse()`), so a cross-owned cart is byte-for-byte indistinguishable from a nonexistent one.
4. Only on a match does the route call the actual use case.

No RBAC/`Permission` involvement — confirmed impossible (§1) — and no duplicated ownership logic: `requireOwnedCart` is the single call site for every one of the six routes that need it.

---

## 7. Current-cart design

`CartRepository.findBySessionRef` — **investigated the existing invariant before adding anything**: `cart.prisma` has `@@index([tenantId, sessionRef])` but no unique constraint preventing more than one active cart per session. Rather than silently assume uniqueness or add a new DB invariant (out of scope — a real design decision, not this phase's to make unilaterally), the port documents a deterministic, honest tie-break: Prisma picks the most-recently-updated active row; the in-memory repository picks the last matching entry in insertion order. This is flagged here, not hidden, per the phase's own instruction ("if a real invariant is missing, report it before changing domain behavior").

`GetCurrentCart` use case: `null` is a valid, successful (`ok`) outcome — never a `NotFoundError`. A session with no cart is the ordinary first-visit state.

---

## 8. Mutation flow

```
Guest clicks "Add to cart" (Product Detail or Collection card)
  → addToCart(productId, quantity) Server Action
  → resolves authoritative price via PriceBook.load() (Pricing, not Catalog's embedded price)
  → reads/mints the guest session cookie
  → GET current cart for that session; POST /public/carts only if none exists
  → POST .../items with the server-resolved price + inventory snapshot
  → revalidatePath("/cart")
```

Quantity/remove/clear on `/cart` follow the same shape: the Client Component (`CartView`) calls a Server Action with `cartId` + the mutation's own fields; the Server Action reads `sessionRef` from the cookie itself — the browser never supplies it.

---

## 9. Security test matrix

`apps/admin/src/http/public-cart-routes.test.ts` (16 tests) covers, against the **real** `wireCart` in-memory composition through the actual `RouteDefinition.handle()` boundary:

- Full lifecycle: create → current → add → current → quantity → current → remove → current → clear
- Ownership: same-session read/mutate succeeds; cross-session read/add/quantity/remove/clear all 404; a forged/random session 404s; unknown-cart-id and cross-owned-cart-id return byte-identical 404 envelopes
- `customerRef` spoofing: a client-supplied `customerRef` on create is silently dropped (zod's default strip behavior — no schema anywhere includes the field); the resulting cart is still `isGuest: true`
- Tenant isolation: two independent tenant compositions never see each other's carts, including when `sessionRef` strings collide across tenants
- DTO boundary regression: no aggregate internals (`props`/`_id`/`_domainEvents`/`_version`) on the wire

`services/cart` (`get-current-cart.use-case.test.ts`, `in-memory-cart-repository.test.ts`, `cached-cart-repository.test.ts`): found/not-found, empty-vs-error distinction, the documented multi-cart tie-break, and the "cache never touched" passthrough test.

`apps/storefront` (`cart-view.test.tsx`, `add-to-cart-button.test.tsx`, `cart.test.ts`, `product-card.test.tsx`): every mutation calls the right Server Action with the right arguments; ownership/network error states render distinct messages; Arabic rendering; add-to-cart button omitted entirely when no price is published, disabled when out of stock; the title link is never nested inside the button (no invalid interactive nesting).

**Explicitly NOT re-verified at the zod-schema layer by the route-level tests**: `route.handle()` is called directly (same technique the pre-existing Phase 3 test used), which bypasses `executeRoute`'s zod parsing. An empty `sessionRef` reaching a real request 422s before ownership ever runs (`.min(1)` on every schema); at the harness level, the defense-in-depth backstop was verified instead — an empty string still can't match a real cart's `sessionRef` and still 404s.

---

## 10. Browser verification

Docker/Postgres are unavailable in this sandbox (§11), so real end-to-end browser verification ran against a **genuine Fastify server** — `createAdminHttpApi` (the exact same composition `apps/runtime/src/api.ts` serves in production) booted fully in-memory via a temporary script, deleted after use — talking to the real Next.js storefront dev server, both over real HTTP, in a real browser tab.

Seeded one real product + published price via the admin API, then, through actual clicks (not simulated events):

- Home → Add to cart → success confirmation with a "View cart" link
- `/cart` (no `?cartId=`) shows the item, correct subtotal
- Quantity increase/decrease recalculates the line total and subtotal correctly
- Remove → collapses to the empty state; re-add via Product Detail page → Clear cart → empty state
- **Cookie**: confirmed via the RSC debug payload that a real `crypto.randomUUID()` was minted server-side under the name `lumo-storefront-guest-session`; `document.cookie` from the page returned `""` — HttpOnly confirmed live, not just asserted
- **Cross-session isolation, against the live server** (not just the vitest harness): a forged `sessionRef` got 404 on read/add/clear against the real cart id; the real owner's cart was confirmed untouched afterward
- **i18n/RTL**: switched to Arabic through the real UI — `dir="rtl"`, every mutation control's `aria-label` correctly translated (`إنقاص الكمية`/`زيادة الكمية`/`إزالة`/`إفراغ السلة`)
- **Theme**: toggled to Dark — `class="dark"` applied
- **Breakpoints**: 390 / 768 / 1024 / 1440 — `scrollWidth === clientWidth` at every one (checked in both RTL and dark mode)
- **Console**: zero errors across the entire session

Not separately re-verified live: the "API error"/"unavailable" mutation states — these are exercised by the passing unit tests (`cart-view.test.tsx`, `add-to-cart-button.test.tsx`) with mocked Server Actions, and the code path is identical to the success path already proven live (the same `try`/`catch`-free `postItem`/`fetchItem` helpers, differing only in the response status).

---

## 11. Prisma/runtime verification

**Blocked.** `docker info` fails: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine ... The system cannot find the file specified.` Per instruction, Docker/WSL2 was **not** repaired. `apps/runtime`'s real entrypoint (`src/api.ts`/`src/config.ts`) requires `DATABASE_URL`/`REDIS_URL` unconditionally (no in-memory fallback at the config layer), so the production entrypoint itself could not be started either.

What was proven instead, and how it differs from real Prisma:

- `PrismaCartRepository.findBySessionRef` was **written** (most-recently-updated active row, tenant + status scoped, reusing the same mapper as `findById`) but has **no dedicated unit test** — consistent with this repo's existing convention (no `PrismaCartRepository` test file existed before this phase either; Prisma repositories aren't unit-tested here, only exercised against a live database).
- Every other layer (repository port + in-memory impl, use case, HTTP routes, storefront) was verified either via vitest (real code, fake/in-memory persistence) or a real, running, in-memory Fastify server + real browser (§10) — genuine HTTP boundary, genuine cookies, not real Postgres.

This is clearly and honestly distinguished from real Prisma verification, not blurred.

---

## 12. Quality-gate results

| Gate         | Command                                        | Result                                                                                                                                                              |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck` (root, 81 packages via turbo) | **78/78 successful**                                                                                                                                                |
| Test         | `pnpm test` (root, 81 packages via turbo)      | **78/78 successful**                                                                                                                                                |
| Lint         | `pnpm lint` (root, 81 packages via turbo)      | **78/78 successful**                                                                                                                                                |
| Architecture | `pnpm arch` (dependency-cruiser)               | **0 violations, 1564 modules, 6782 dependencies cruised**                                                                                                           |
| Governance   | `pnpm governance`                              | **Does not exist in this checkout** — no such script in root `package.json`, no `scripts/governance/run.mjs` on disk. Reported as-is per instruction, not invented. |
| Duplication  | `pnpm dup`                                     | **Does not exist in this checkout** — no such script, no `.jscpd.json` on disk. Reported as-is.                                                                     |

(`@platform/cart`: 42/42 tests. `@platform/admin`: 72/72 tests, including the 16 new/rewritten `public-cart-routes.test.ts`. `storefront`: 64/64 tests.)

---

## 13. Issues discovered

- The pre-existing `GET /public/carts/:cartId` route (Phase 3) had no ownership check of any kind — any caller who knew a cart id could read any tenant-scoped cart's contents. Closed (§9/§14).
- No DB-level invariant prevents more than one active cart per `sessionRef` (§7) — a genuine gap, reported rather than silently patched with a new domain rule or migration.
- `CachedCartRepository` had no `findBySessionRef` — adding it forced an explicit decision (uncached passthrough) rather than inventing a caching strategy no one asked for.

## 14. Issues fixed

- Ownership enforcement added to every guest-reachable cart route, including retrofitting the pre-existing `GET /public/carts/:cartId` (now requires a matching `sessionRef` query param — a deliberate, security-justified contract change on an existing route, called out explicitly here rather than left as a silent diff).
- `CART_COOKIE`/`?cartId=`/`resolveCart`/`getCart(cartId)` — fully removed (dead code, and the old cookie's semantics — "remember a cart id" with no ownership check — were exactly the design flaw being fixed).
- `ProductCard`'s whole-card `<Link>` — restructured to stop wrapping the card in an anchor, because a `<button>` cannot legally nest inside an `<a>` once a real add-to-cart button exists there. Verified live: the button's closest ancestor is not an `<a>`.

## 15. Issues intentionally not fixed

- **Guest add-to-cart's price/inventory snapshot is caller-supplied**, exactly like the pre-existing admin `POST /carts/:cartId/items` route already is — this is Cart's own deliberate, documented bounded-context design ("Pricing/Inventory are never imported... supplied by the caller"), not something this phase introduced or worsened for admins. For the storefront, the "caller" is the Next.js Server Action, which resolves the snapshot from `PriceBook`/`AvailabilityBook` (Pricing/Inventory-backed, never Catalog's embedded price) before calling the Runtime API — the browser itself never supplies a price. Residual risk: since the Runtime API's public routes are reachable directly (not exclusively via Next.js), a caller that bypasses the storefront and calls the Runtime API directly could in principle submit an arbitrary price. This is architecturally identical to the pre-existing admin route's trust model, not a new hole, and closing it would mean either (a) making Cart import Pricing directly (a bounded-context violation this phase was told not to introduce) or (b) duplicating Pricing's price-resolution logic inside `apps/admin`'s HTTP layer (a new cross-cutting mechanism outside this phase's stated scope). Flagged here for a principal-architect decision, not silently accepted.
- Multiple active carts per session (§7/§13) — reported, not "fixed" with an invented invariant.

## 16. Remaining blockers

- Docker Desktop / WSL2 unavailable in this sandbox — blocks real Prisma verification (§11) and running `apps/runtime`'s actual entrypoint. Not a code defect; an environment blocker, consistent with every prior sprint's finding in this same sandbox.
- `pnpm governance` / `pnpm dup` do not exist in this checkout (§12) — cannot be run or reported on beyond that fact.

## 17. SAGA-6 status

Untouched, as instructed. SAGA-6 (Checkout's `StartCheckout` orchestration never calling `Cart.lock()`) is a Checkout-saga gap, unrelated to guest cart identity/ownership. `Cart.lock()` exists on the domain and was not exposed to the guest surface (§5) — no interaction with SAGA-6 either way.

## 18. Authenticated customer ownership status

Out of scope, as instructed, and genuinely untouched:

- No login/Kratos/customer-authentication code was added.
- No Identity → Customer mapping was introduced.
- `Cart.assignCustomer()` and `Cart.merge()` exist on the domain (pre-existing, Sprint 4.5) but **no use case wraps `assignCustomer`** — confirmed by the original research pass and unchanged by this phase. Guest → authenticated cart merge remains a future phase's work, building on the `sessionRef`/ownership foundation this phase establishes.

## 19. Production-readiness verdict

**Guest Cart Foundation is production-ready for its own stated scope**, against every criterion the phase specifies:

- ✅ Guest session is server-issued (Next.js `crypto.randomUUID()`, never client-chosen)
- ✅ Cart ownership is enforced (one helper, every read/mutation route, verified live against a real forged session)
- ✅ Cart ID alone is insufficient for mutation or read (verified live)
- ✅ `customerRef` cannot be spoofed (no schema anywhere accepts it; verified in tests)
- ✅ Tenant isolation intact (unchanged mechanism; explicitly tested)
- ✅ All public mutations have ownership tests
- ✅ Current cart works without a manually supplied cart id (verified live)
- ✅ No admin credentials reach the storefront (public routes require no bearer token; storefront never authenticates)
- ✅ No checkout/merge/lock operations are exposed (verified by an explicit route-inventory test)
- ⚠️ Real Prisma verification not performed — **explicitly documented** infrastructure blocker (§11), not faked
- ✅ All available quality gates pass (`governance`/`dup` don't exist in this checkout; everything else is green)

**Not committed** — left in the working tree per this repo's standing sprint-isolation discipline; the user can review the diff before deciding what, if anything, to stage.
