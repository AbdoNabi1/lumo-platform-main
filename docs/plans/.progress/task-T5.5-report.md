# Task T5.5 report — Inventory management

## Summary

Built the Inventory management write screens per the brief: a new `lib/api/inventory.ts` (8 typed
mutate functions), product-scoped receive/adjust forms added to the existing (previously read-only)
`ProductInventoryCard`, and a new standalone `/inventory` operations console for
reserve/release/commit/transfer/register/deactivate. Followed the brief's already-resolved ruling
that `warehouseId` fields are plain text inputs (no `GET /warehouses` list route exists) — same
fallback T5.1 used for brand/category.

## What was built

1. **`apps/admin-web/src/lib/api/inventory.ts`** (new) — `receiveStock`, `adjustStock`,
   `reserveStock`, `releaseReservation`, `commitReservation`, `transferStock`, `registerWarehouse`,
   `deactivateWarehouse`, all calling `mutateAdminApi`. Confirmed by reading
   `services/inventory/src/interfaces/inventory.controller.ts` and `warehouse.controller.ts` that
   every one of the 8 admin-routes handlers delegates to `present(await useCase.execute(input),
   status)` with no DTO mapping step — so every function uses the `isUnknown` pattern (reads
   nothing off the response body beyond "did it succeed"), exactly like `lib/api/products.ts`'s
   T5.1 write functions and `lib/api/fulfillment.ts`'s T5.4 write functions.

2. **`apps/admin-web/src/app/inventory/actions.ts`** (new) — 8 Server Actions (`receiveStockAction`
   through `deactivateWarehouseAction`), kept in their own file even though two of them render
   inside the Product Detail page, per the brief's explicit instruction. Each: parses `FormData`
   defensively, mints exactly one `newIdempotencyKey()` per submit (including for `reserveStock`/
   `transferStock`, whose routes are `idempotent: false` — the header is still sent, per rule 8),
   calls the typed `lib/api/inventory.ts` function, and projects any non-`ok` outcome through
   `toFormState`. Receive/adjust/reserve/release/commit/transfer all `revalidatePath` the product's
   own detail page (`/products/:productId`) on success; register/deactivate have nothing to
   revalidate (no list screen exists for warehouses).

3. **Product-scoped actions** — `ProductInventoryCard`
   (`apps/admin-web/src/components/products/product-inventory-card.tsx`) stayed an async Server
   Component (still owns the `fetchProductInventory` call), but its table rendering moved into a
   new client component, **`apps/admin-web/src/components/products/product-inventory-table.tsx`**
   (a Server Component can't also be `"use client"`, so the interactive half had to split out, same
   reasoning `ProductVariantsCard` already established for variants). It renders:
   - Per-row "Receive"/"Adjust" buttons that expand into an inline form (quantity / on-hand), same
     toggle-and-auto-close-on-success pattern as `ProductVariantsCard`'s `VariantEditRow` (T5.1).
   - A standalone "Receive stock at a warehouse" form below the table (plain `warehouseId` text
     input + quantity) — added because `receive` is what creates a warehouse's first stock row for
     a product; without it, a product with zero inventory rows (or a brand-new warehouse) would
     have no way to receive its first stock through this card at all. This is a scope judgment
     call, not a backend gap — flagged here for visibility, not in BLOCKERS.md, since nothing was
     blocked or fabricated (it's the same `receiveStock` action, same plain-text `warehouseId`
     ruling, just offered as a second entry point).

4. **Warehouse/reservation/transfer console** — new `apps/admin-web/src/app/inventory/page.tsx`
   plus its client forms in `apps/admin-web/src/components/inventory/inventory-operations-forms.tsx`
   (`RegisterWarehouseForm`, `DeactivateWarehouseForm`, `TransferStockForm`, `ReserveStockForm`,
   `ReleaseReservationForm`, `CommitReservationForm`). Four `Card` sections exactly as the brief
   specified ("Register warehouse", "Deactivate warehouse", "Transfer stock", "Reservations" with
   its 3 sub-forms), each form independently wired with its own `useActionState` and its own
   success/error feedback — no shared table, since this screen has no read/list backing it.

5. **Navigation** — added `{ id: "inventory", ... href: "/inventory", Icon: WarehouseIcon }` to
   `PRIMARY_NAV` in `apps/admin-web/src/components/navigation.ts`, positioned right after
   `products`. `WarehouseIcon` was not previously imported; added it to the `lucide-react` import
   list.

6. **`middleware.ts`** — added `["/inventory", "operator"]` to `ROUTE_ROLE_REQUIREMENTS`, positioned
   after the `/products` entries (longest-prefix match means order among non-overlapping prefixes
   doesn't matter functionally, but this keeps route-table order roughly matching nav order).

7. **Dictionaries** — added every new string to both `apps/admin-web/src/messages/en.ts` and
   `ar.ts`: `nav.inventory`, a new `inventoryPage` section (operations console strings) placed
   right before `productsPage`, and a new `inventoryRowForm` section (product-card inline-form
   strings) placed right after `productWriteCommon`. `ar.ts` is typed against `en.ts`'s `Dictionary`
   export (`import type { Dictionary } from "./en"`), so a missing key would have been a compile
   error — `tsc --noEmit` passing confirms both dictionaries stayed in sync.

## Ruling followed (from the brief, not re-derived)

No `GET /warehouses` (or any warehouse list) route exists in `admin-routes.ts` — confirmed by
reading it directly (only `POST /warehouses` and `POST /warehouses/:warehouseId/deactivate`).
Every `warehouseId`/`sourceWarehouseId`/`destinationWarehouseId` field in both new screens is a
plain text input, never a picker, and never backed by `ProductInventoryCard`'s per-product
inventory rows (which only ever reflect one product's existing stock activity, not the warehouse
registry). Added `docs/plans/BLOCKERS.md`'s **T5.5** entry, cross-referencing T5.1's brand/category
entry as the same class of gap, and marked `docs/plans/PHASE-5-6-backlog.md`'s T5.5 checkbox done.

## Files changed

- `apps/admin-web/src/lib/api/inventory.ts` (new)
- `apps/admin-web/src/lib/api/inventory.test.ts` (new)
- `apps/admin-web/src/app/inventory/actions.ts` (new)
- `apps/admin-web/src/app/inventory/page.tsx` (new)
- `apps/admin-web/src/components/inventory/inventory-operations-forms.tsx` (new)
- `apps/admin-web/src/components/products/product-inventory-table.tsx` (new)
- `apps/admin-web/src/components/products/product-inventory-card.tsx` (edited — delegates table
  rendering to the new client component; no longer renders the table inline)
- `apps/admin-web/src/components/navigation.ts` (edited — new `inventory` nav entry + `WarehouseIcon`
  import)
- `apps/admin-web/src/middleware.ts` (edited — new `["/inventory", "operator"]` route-role entry)
- `apps/admin-web/src/messages/en.ts` (edited — `nav.inventory`, `inventoryPage`, `inventoryRowForm`)
- `apps/admin-web/src/messages/ar.ts` (edited — same three additions, translated)
- `docs/plans/BLOCKERS.md` (edited — new T5.5 entry)
- `docs/plans/PHASE-5-6-backlog.md` (edited — T5.5 checkbox marked done)

No files under `apps/admin`, `services/*`, or `packages/*` were touched. No files under the four
prior tasks' scopes (`products/*` other than the one card noted, `orders/*`) were touched.

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

- **typecheck**: clean (`tsc --noEmit`, no output, exit 0).
- **lint**: clean — 0 errors, 1 pre-existing warning in `next.config.ts`
  (`Async method 'headers' has no 'await' expression`), unrelated to this task and present before
  any change here.
- **test**: **45 test files passed, 417 tests passed** (0 failed), including the 9 new tests in
  `lib/api/inventory.test.ts` covering all 8 write functions' request shape (path, method, body,
  idempotency header) plus a 403→`forbidden` mapping check, same discipline as
  `fulfillment.test.ts`'s T5.4 tests.

No component-level test files were added for `product-inventory-table.tsx` or
`inventory-operations-forms.tsx` — this matches T5.3/T5.4's precedent (their new write forms also
went untested at the component level; only `lib/api/*.test.ts` got new tests for those tasks) rather
than T5.1's precedent (which did add component tests for its variants card). Not run in a live
browser — no Docker available in this environment, same standing limitation
`docs/plans/BLOCKERS.md`'s "Phase 3 screens not verified in a live browser" note already documents
for every prior UI task in this repo.

## Concerns / judgment calls for review

1. **The standalone "Receive stock at a warehouse" form** (item 3 above) goes slightly beyond the
   brief's literal "per-warehouse-row" wording — added so a product with zero existing inventory
   rows isn't a dead end. If a reviewer wants a strictly literal reading, this form (and its
   `ReceiveNewStockForm` component in `product-inventory-table.tsx`) can be deleted with no impact
   on anything else; the per-row Receive/Adjust forms stand alone.
2. Per-package verification only (`pnpm --filter admin-web ...`), not a repo-wide `turbo` run —
   consistent with every prior phase's documented Windows `turbo` environment failure in
   `docs/plans/BLOCKERS.md`. Nothing outside `admin-web` was touched this task.
