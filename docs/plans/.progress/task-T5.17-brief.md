# Task T5.17 brief — Customer auth foundation + Wishlist

This task is bigger than a typical Phase 5 task: it builds the customer authentication
**foundation** T5.16 designed (nothing was implemented for T5.16 — it produced a design only),
then builds Wishlist on top of it as the first real feature to use it. T5.19 (Loyalty) and
T5.18's write half (review authoring) will reuse whatever you build here in later dispatches — so
build the foundation as a genuinely reusable guard/session layer, not something wishlist-specific.

**Read `docs/plans/BLOCKERS.md`'s full `## T5.16` entry first — it is the authoritative design for
everything in "Part A" below, with exact file paths, line numbers, and reasoning already worked
out. Do not re-derive the design; implement it. If you find a specific point underspecified,
make the smallest reasonable call, document it, and continue — do not stall.**

## Part A — Customer auth foundation (build once, reused by T5.19 and T5.18-write later)

Per the T5.16 design:

1. **Principal provisioning.** Wire `services/security`'s `Principal.register`/
   `RegisterPrincipal` use case (`services/security/src/application/principal.use-cases.ts`) so a
   `Principal` (`kind: "human"`, `subjectRef: customer.id.toString()`) is created alongside a
   `Customer` — either inside `Customer.register()`'s own flow via a new port (mirroring
   `OrderCreationPort`/`OrderCreationAdapter`'s cross-context adapter pattern, per the design) or
   lazily on first successful authentication. Pick whichever is less invasive to
   `services/identity`'s existing registration flow; document the choice.
2. **`CustomerGuard`** — a new, lighter guard parallel to `AdminGuard`
   (`apps/admin/src/interfaces/admin-guard.ts`, read it as the shape to mirror): "is there a
   valid, unexpired customer session" only, no `Permission`/ABAC check. Resolves
   session → `Principal` → `Customer` server-side.
3. **`CustomerAuthController`** (new, `apps/admin/src/interfaces/` or similar) — thin wrapper
   around Security's existing `Authenticate`/`EstablishSession`/`RefreshSession`/`RevokeSession`
   use cases, parallel to `SecuritySessionsAdminController` but `public: true` at the route level.
4. **New public routes**: `POST /public/auth/register`, `POST /public/auth/login`,
   `POST /public/auth/logout`, `POST /public/auth/refresh` — in a new
   `apps/admin/src/http/public-auth-routes.ts` (matching the existing `public-cart-routes.ts`/
   `public-checkout-routes.ts`/`public-reviews-routes.ts` one-domain-per-file convention).
5. **Session cookie** — `apps/storefront/src/lib/`: a new `CUSTOMER_SESSION_COOKIE =
   "lumo-storefront-customer-session"`, distinct from `GUEST_SESSION_COOKIE`, same
   `HttpOnly`/`Secure`-in-prod/`SameSite: "lax"` shape as the guest cookie's options but a shorter
   sliding TTL (~30–120 minutes, refreshed on activity via `RefreshSession`). Never carries a raw
   `customerRef` — only an opaque session id, resolved server-side on every request.
6. **Guest-cart-to-customer merge on login** — wire the existing `Cart.assignCustomer`/
   `Cart.merge` domain methods (`services/cart/src/domain/cart.ts` — confirm exact method names
   there, the design names them but verify signatures yourself) so a successful login folds the
   guest cart (from `GUEST_SESSION_COOKIE`) into the customer's own cart, then clears the guest
   cookie.
7. **Storefront pages**: `apps/storefront/src/app/account/login/page.tsx`,
   `.../register/page.tsx`, a logout action, and a minimal `apps/storefront/src/app/account/
   page.tsx` landing page (just enough to prove the session works — the full account/profile UI
   is not required by this task, only auth + wishlist are).
8. Every new backend piece gets tests at the layer it's introduced (use-case, controller, route) —
   follow the nearest existing analogous test's style (e.g. `public-cart-routes.test.ts` for the
   new public auth routes).

## Part B — Wishlist (the first real feature built on the foundation above)

`apps/admin/src/http/wishlist-routes.ts` (read in full, already fully built — 9 routes: create,
advance/archive, add-item, remove-item, share-item, move-item-to-cart, list, get-by-customer,
get) is complete but entirely admin-guarded. Per the same pattern T5.18 used (extend
`admin.publicReads` with an unguarded controller, do NOT route through the guarded
`WishlistAdminController` — read `public-reviews-routes.ts`'s composition.ts change and its doc
comment for exactly why, then do the same for `wishlist`), add public routes scoped by the
authenticated customer session from Part A — never a client-supplied `customerRef`. Cover:
get-my-wishlist (create-on-first-access if none exists, since a customer has at most one),
add-item, remove-item, share-item (a share token is meant to be given to someone without an
account — the route that *resolves* a share token, if the backend has one, may stay public
without auth; check `wishlist-routes.ts`/`services/wishlist` for a share-token-resolution
capability and wire it as a separate, unauthenticated public route if it exists), move-item-to-cart.

Storefront: a wishlist page under `apps/storefront/src/app/account/wishlist/page.tsx` (or similar,
match whatever `account/` structure Part A established), an "add to wishlist" affordance on the
product card/detail page (only rendered/enabled when a customer session exists — no wishlist UI
for anonymous shoppers, since there is nothing to scope it to).

## Global constraints (Phase 5 storefront tasks)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate data or a fake session — every wishlist/auth response must come from a real,
   validated round-trip through the mechanisms built in Part A.
4. Every user-facing string in both storefront dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`. If Part A turns out to need more
   than one dispatch's worth of work to land safely, it is fine to land Part A alone, verify it
   fully, and leave Part B for a follow-up dispatch — note this explicitly in your report rather
   than rushing Part B in on top of a shaky foundation.
7. Mark T5.17's checkbox (`- [ ] **T5.17 Wishlist.**` → `- [x] **T5.17 Wishlist.**`) only once
   both Part A and Part B are complete and verified; if you land Part A only, leave the checkbox
   unticked and say so clearly, so the controller dispatches a follow-up rather than assuming done.
8. One `Idempotency-Key` per user-initiated submit on every new write route.
9. The storefront calls the runtime API only from Server Components/Server Actions.
10. Passwords/credentials: never log them, never store them anywhere but through Security's
    existing credential machinery — this task reuses that machinery, it does not reimplement
    password hashing/storage itself.

## Verify

```bash
pnpm --filter @platform/security typecheck && pnpm --filter @platform/security test
pnpm --filter @platform/identity typecheck && pnpm --filter @platform/identity test
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm --filter storefront typecheck && pnpm --filter storefront lint && pnpm --filter storefront test
pnpm arch
```

## Report

Write your full report to `docs/plans/.progress/task-T5.17-report.md`, stating clearly whether
both parts landed or only Part A. Return to the controller only: status, files changed (grouped by
package), one-line test summary per package, concerns.
