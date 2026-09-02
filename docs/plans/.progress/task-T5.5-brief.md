# Task T5.5 brief — Inventory management

Same write-screen recipe as prior Phase 5 tasks (`apps/admin-web/README.md`). This domain has
**no existing `lib/api/inventory.ts`** — you are creating it from scratch (the only existing
inventory code is `fetchProductInventory` in `lib/api/products.ts`, which stays where it is; do
not move it).

## Routes — all in `apps/admin/src/http/admin-routes.ts`, lines ~1503-1581

| Route | Method | Permission | Idempotent | Body (zod, verbatim) |
| --- | --- | --- | --- | --- |
| `/inventory/receive` | POST | `inventory:receive` | yes | `{ productId, warehouseId, quantity: int().positive() }` |
| `/inventory/adjust` | POST | `inventory:adjust` | yes | `{ productId, warehouseId, onHand: int().min(0) }` |
| `/inventory/reserve` | POST | `inventory:reserve` | **no** | `{ productId, warehouseId, quantity: int().positive(), reference: string.min(1) }` |
| `/inventory/release` | POST | `inventory:release` | yes | `{ productId, warehouseId, reservationId: string.min(1) }` |
| `/inventory/commit` | POST | `inventory:commit` | yes | `{ productId, warehouseId, reservationId: string.min(1) }` |
| `/inventory/transfer` | POST | `inventory:transfer` | **no** | `{ productId, sourceWarehouseId, destinationWarehouseId, quantity: int().positive() }` |
| `/warehouses` (register) | POST | `warehouse:register` | yes | `{ code: string.min(1), name: string.min(1) }` |
| `/warehouses/:warehouseId/deactivate` | POST | `warehouse:deactivate` | yes | none (params only) |

All `productId`/`warehouseId`/`sourceWarehouseId`/`destinationWarehouseId` fields are plain
`string.min(1)`.

## No list endpoint for warehouses — same gap class as T5.1's brand/category finding

There is no `GET /warehouses` (or any warehouse list) route in this codebase. `ProductInventoryCard`
today reads `GET /products/:productId/inventory`, which returns one row **per warehouse the
product already has stock rows in** — that is the only source of known warehouse ids in this app.
**Ruling:** render `warehouseId` fields as plain text inputs (same fallback T5.1 used for
brand/category), and add one `docs/plans/BLOCKERS.md` entry noting the missing `GET /warehouses`
list endpoint (link this entry and T5.1's, they are the same class of gap). Do not build a
warehouse picker against fabricated data, and do not add the backend endpoint yourself.

## What to build

1. **`apps/admin-web/src/lib/api/inventory.ts`** (new) — 8 typed mutate functions
   (`receiveStock`, `adjustStock`, `reserveStock`, `releaseReservation`, `commitReservation`,
   `transferStock`, `registerWarehouse`, `deactivateWarehouse`), calling `mutateAdminApi`. None of
   these routes' handlers map through a DTO (check each `admin.inventory.*` handler — if it returns
   the use-case result directly, type only what you need or use the existing `isUnknown` pattern
   from `lib/api/products.ts`, do not invent a DTO for an untyped response).
2. **Product-scoped actions** (receive, adjust): add to `apps/products/[productId]`'s existing
   `ProductInventoryCard` (`apps/admin-web/src/components/products/product-inventory-card.tsx`) —
   per-warehouse-row "Receive" and "Adjust" inline forms, same pattern as T5.1's variants card
   editing. This card already knows the product's id from its props; reuse that, do not
   re-fetch it. New Server Actions go in `apps/admin-web/src/app/products/actions.ts`? **No** —
   inventory actions are their own domain; put them in a new
   `apps/admin-web/src/app/inventory/actions.ts` even though the form renders inside the product
   page (Server Actions do not need to live under the route that renders them; this keeps
   `products/actions.ts` from ballooning across two domains).
3. **Warehouse + reservation + transfer management screen** (new): reserve/release/commit and
   transfer are not scoped to a single product's card in a way that reads well inline (transfer in
   particular needs two warehouse ids). Add `apps/admin-web/src/app/inventory/page.tsx`: a simple
   operations screen with four sections — "Register warehouse" (code, name), "Deactivate warehouse"
   (warehouseId), "Transfer stock" (productId, sourceWarehouseId, destinationWarehouseId, quantity),
   and "Reservations" (three sub-forms: reserve / release / commit, each taking the fields in the
   table above). This screen has no read/list backing it (per the gap above) — it is a pure
   operations console, not a data table; render it as a set of independent forms with their own
   success/error feedback (`useActionState` per form), not a shared table.
4. **Navigation**: add an `inventory` entry to `PRIMARY_NAV` in
   `apps/admin-web/src/components/navigation.ts` pointing at `/inventory` (pick a reasonable
   `lucide-react` icon, e.g. `WarehouseIcon` or `PackageIcon` — check what's already imported
   there and stay consistent).
5. **`middleware.ts`**: add `["/inventory", "operator"]` to `ROUTE_ROLE_REQUIREMENTS` (these are
   all write operations; `operator`, matching T5.2's choice for order writes — never `viewer`).
6. Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (apply to every Phase 5 admin task)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate data — the warehouse-picker ruling above is this rule applied to one field.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark this task's checkbox (`- [ ] **T5.5 Inventory management.**` → `- [x] ...`) when done, and
   add the BLOCKERS.md entry — both required.
8. One `Idempotency-Key` per user-initiated submit, minted once, regardless of the route's own
   `idempotent` flag.
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.5-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
