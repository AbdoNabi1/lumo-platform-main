# Phase S1 — Integration Completion — Milestone 13 (Wishlist Admin Wiring) — Report

**Status:** Complete. Reuses the Coupons/Loyalty pattern (Milestones 1/9) unchanged. First milestone
of the "Remaining Admin Wiring" continuation after the original S1 12-item batch + S1.5 Security
sub-milestones closed — found by a fresh, direct audit of `apps/admin/src/composition.ts` against
every real bounded context in `services/*` (excluding the `services/example` scaffold package),
rather than by re-reading a prior session's scope note (none named this gap).

**Trigger:** direct audit found the Wishlist bounded context (`@platform/wishlist`, committed,
working `wireWishlist()` + `WishlistController`) had zero admin-app exposure — no admin controller,
no `composition.ts` entry, no HTTP route — despite 37 other contexts already following this exact
pattern. This is a pure additive wiring gap, not a design or contract change.

---

## 1. Scope

**In scope:** expose Wishlist's six existing use cases (`create`, `advance`, `addItem`,
`removeItem`, `shareItem`, `moveItemToCart`) through the admin app, replicating the established
`*AdminController` → `composition.ts` → `*-routes.ts` → `admin-routes.ts` pattern used by all
already-wired contexts (e.g. `CouponsAdminController`).

**Explicitly not touched:** `services/wishlist/**` (the context itself — already correct, zero
changes needed), any other context's wiring, `apps/runtime`, any public contract/event shape,
Finance M2 / Analytics V2 / Runtime module framework (out of scope per explicit user decision —
those remain below the evidence threshold and are not touched by this or any milestone in this
batch).

---

## 2. Files changed, and why

| File                                                           | Change                                                                                                                                                                                                                                                                         | Why                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `apps/admin/src/interfaces/wishlist.admin-controller.ts` (new) | `WishlistAdminController` — thin wrapper over `WishlistController`, authorizes `wishlist:create`/`advance`/`add-item`/`remove-item`/`share-item`/`move-item-to-cart` via `AdminGuard` before delegating                                                                        | Same shape as every existing `*AdminController`                                                         |
| `apps/admin/src/http/wishlist-routes.ts` (new)                 | `wishlistRoutes(admin)` — 6 routes: `POST /wishlists`, `POST /wishlists/:wishlistId/transitions`, `POST /wishlists/:wishlistId/items`, `POST /wishlists/:wishlistId/items/remove`, `POST /wishlists/:wishlistId/items/share`, `POST /wishlists/:wishlistId/items/move-to-cart` | Same shape as `loyalty-routes.ts`'s `:id` + sub-action pattern                                          |
| `apps/admin/src/composition.ts`                                | Added `wireWishlist` import, `WishlistAdminController` import, `wishlist` field on `WiredAdmin`, `wireWishlist(deps)` call, added to the `contexts` drain array, constructed `WishlistAdminController` in the return                                                           | Wires Wishlist into the admin composition root exactly like the other 37                                |
| `apps/admin/src/http/admin-routes.ts`                          | Added `wishlistRoutes` import + spread                                                                                                                                                                                                                                         | Exposes the new routes                                                                                  |
| `apps/admin/package.json`                                      | Added `@platform/wishlist: workspace:*` dependency                                                                                                                                                                                                                             | Was missing                                                                                             |
| `pnpm-lock.yaml`                                               | Updated via `pnpm install`                                                                                                                                                                                                                                                     | Mechanical                                                                                              |
| `apps/admin/src/admin.e2e.test.ts`                             | Added one regression test: create → add-item → share-item → move-to-cart → add-item → remove-item → advance(archived)                                                                                                                                                          | Closes coverage gap; isolated `it()` block, same convention as every other per-screen test in this file |

No changes to `services/wishlist/**`, any other service, any event contract, or any public API
shape outside `apps/admin`.

---

## 3. Quality gates

| Gate                                   | Scope                                 | Result                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `typecheck`                            | full monorepo (`turbo run typecheck`) | 76/76 packages, 0 errors                                                                                                                                                             |
| `lint`                                 | full monorepo (`turbo run lint`)      | 76/76 packages, 0 errors                                                                                                                                                             |
| `test`                                 | full monorepo (`turbo run test`)      | 76/76 packages green, `@platform/admin` 31/31 (was 30/30; +1 new)                                                                                                                    |
| `arch` (`depcruise packages services`) | full                                  | 0 violations, 1531 modules, 6522 dependencies — module count unchanged (arch scans `packages`+`services` only, not `apps/admin`, consistent with every prior admin-wiring milestone) |

---

## 4. Architecture impact

None. Pure composition-root wiring addition following an existing, established pattern — no new
abstractions, no changed contracts, no cross-context coupling (Wishlist's admin controller depends
only on Wishlist's own `WishlistController`, same as every sibling admin controller).

---

## 5. Pattern deviation

**None.** The Coupons/Loyalty pattern was reused unchanged.

---

## 6. Remaining blockers / next steps

- One more context remains unwired: `customer-360` (`Customer360Controller`, 4 read-only methods:
  `getProfile`/`getIdentityTimeline`/`getJourneyTimeline`/`getJourneyState`) — next milestone
  (S1 M14).
- After M14, roadmap item 4 ("Remaining Admin Wiring") should be re-audited in full (every
  `services/*` directory cross-checked against `composition.ts` + `admin-routes.ts`) before being
  declared complete.
- Finance M2, Analytics V2, and the legacy Runtime module framework remain explicitly out of scope
  per user decision (2026-08-03) — no primary specification exists for any of the three; not
  investigated or touched by this milestone.
