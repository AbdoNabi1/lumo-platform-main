# Task T5.7 brief — Categories and brands

Same write-screen recipe as prior Phase 5 tasks. **This task includes a small, contained backend
addition** (unusual for this phase — read the ruling below before starting; it is not optional).

## Ruling already made — read before you start

T5.1 (already shipped) found that the Product editor's brand/category fields could not be real
pickers because: (1) **no `GET /brands` route exists at all**, and (2) **`GET /categories` exists
but its handler returns the raw `Category` domain aggregate**, not a DTO (`admin-routes.ts` line
~946: `handle: ({ query, context }) => admin.products.listCategories(context.principal, query)` —
a direct passthrough, no `toCategoryDto` mapping, unlike every product route). T5.1 worked around
both gaps with plain text id inputs and deferred the real fix to this task
(`docs/plans/BLOCKERS.md`'s "T5.1" entry).

**Ruling:** fix both, as a small vertical slice — this is the same class of fix T0.6 already made
once for Analytics (a DTO-mapping fix at the route layer), and the repository port for brands
already exists (`BrandRepository.list()` in `services/catalog/src/domain/brand-repository.ts` —
only the use-case/controller/route layers above it are missing). This is NOT a general invitation
to build out unrelated backend features — scope is exactly: one new `ListBrands` use case, one new
`BrandController.list` method, one new `listBrands` method on `ProductsAdminController`, one new
`GET /brands` route with a `toBrandDto` mapper, and a `toCategoryDto` mapper applied to the
existing `GET /categories` route. Do not touch anything else in `services/catalog`.

### Backend steps (do these first, in this order)

1. **`services/catalog/src/application/list-brands.use-case.ts`** (new) — copy
   `list-categories.use-case.ts` verbatim, substituting `Brand`/`BrandRepository`/`brands`:
   ```ts
   export interface ListBrandsDeps { readonly brands: BrandRepository; }
   export class ListBrands implements UseCase<CursorPage, Paginated<Brand>, DomainError> {
     constructor(private readonly deps: ListBrandsDeps) {}
     async execute(input: CursorPage): Promise<Result<Paginated<Brand>, DomainError>> {
       return ok(await this.deps.brands.list(input));
     }
   }
   ```
2. **`services/catalog/src/interfaces/brand.controller.ts`** — add `listBrands: ListBrands` to
   `BrandControllerDeps`, and a `list(input: CursorPage)` method mirroring
   `category.controller.ts`'s `list` (`return present(await this.deps.listBrands.execute(input),
   200);`).
3. **`services/catalog/src/composition.ts`** (~line 157, where `brandController` is built) — add
   `listBrands: new ListBrands({ brands }),` to the `BrandController` constructor call, same
   pattern as `categoryController`'s `listCategories: new ListCategories({ categories }),` right
   above it.
4. **`apps/admin/src/interfaces/products.admin-controller.ts`** — add a `listBrands` method
   mirroring `listCategories` (lines 231-238) exactly: guard `"brands:read"`, delegate to
   `this.brands.list(input)`.
5. **`apps/admin/src/http/admin-routes.ts`**:
   - Add `toCategoryDto`/`toBrandDto` mappers near the existing product DTO mappers (top of file):
     flat `{ id: string, name: string, slug: string, parentId: string | null }` for category
     (from `Category`'s `id`/`name`/`slug.value`/`parentId` — check the exact getters on the class,
     read `category.ts`/`brand.ts` fully first, do not guess field names) and
     `{ id: string, name: string, slug: string }` for brand. Do not include `deleted` in either DTO
     (soft-deleted rows should not surface at all — check whether the repository's `list()` already
     filters deleted entries; if not, filter them out in the mapper, do not surface a `deleted:
     true` row to the picker).
   - Change the existing `GET /categories` route's `handle` to `mapPage(await
     admin.products.listCategories(...), toCategoryDto)` (same `mapPage` helper already imported
     and used by the `/products` list route — do not reinvent pagination mapping).
   - Add a new `GET /brands` route: `permission: "brands:read"`, `schema: { querystring:
     listCategoriesQuery }` (reuse the existing `{ first?, after? }` shape — no need for a separate
     const), `handle: ({ query, context }) => mapPage(await admin.products.listBrands(
     context.principal, query), toBrandDto)`.
6. Run `pnpm --filter @platform/catalog typecheck && pnpm --filter @platform/catalog test` and
   `pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test` after the
   backend changes, before moving to the frontend — do not let a backend break surface only at the
   very end. Also run `pnpm arch` (you touched `services/catalog`) — must show "no dependency
   violations found".
7. Write a test for the new `ListBrands` use case (co-located, same style as
   `list-categories.use-case`'s existing test if one exists — check first) and for the new route
   (existing `admin-http.e2e.test.ts` or a route-level test, follow whatever the nearest existing
   category/brand route test does).

## Frontend routes — full set now available

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/categories` (list) | GET | `categories:read` | — | `{ first?, after? }` |
| `/categories` (create) | POST | `categories:create` | yes | `{ name: string.min(1), slug: string.min(1), parentId?: string.min(1) }` |
| `/categories/:categoryId/move` | POST | `categories:update` | yes | `{ newParentId: string.min(1) \| null }` |
| `/categories/:categoryId/delete` | POST | `categories:delete` | yes | none |
| `/brands` (list, new) | GET | `brands:read` | — | `{ first?, after? }` |
| `/brands` (create) | POST | `brands:create` | yes | `{ name: string.min(1), slug: string.min(1) }` |
| `/brands/:brandId` (rename) | POST | `brands:update` | yes | `{ name: string.min(1) }` |
| `/brands/:brandId/delete` | POST | `brands:delete` | yes | none |

## What to build (frontend)

1. `apps/admin-web/src/lib/api/categories.ts` (new) — `fetchCategoriesPage` (list, following
   `fetchProductsPage`'s pattern exactly: `ApiResult` outcomes, `isXPageDto` guard),
   `createCategory`, `moveCategory`, `deleteCategory` (mutate functions).
2. `apps/admin-web/src/lib/api/brands.ts` (new) — same shape: `fetchBrandsPage`, `createBrand`,
   `updateBrand`, `deleteBrand`.
3. `apps/admin-web/src/app/categories/page.tsx` + `actions.ts` (new) — a table (reuse
   `products-table.tsx`/`products-toolbar.tsx`/`products-pagination.tsx`'s structure as the
   reference for a paginated admin table) with inline create/move/delete actions. Category is
   hierarchical (`parentId`) — render it as a flat cursor-paginated list with a "Parent" column
   showing the parent's id (do not build a tree widget, out of scope), and a "move" action that
   takes a new parent id (plain text input is fine, same fallback discipline as elsewhere when no
   richer picker is in scope — though note a `fetchCategoriesPage` now exists, so a `<select>` of
   known categories is reasonable here since you now have the list to populate it from).
4. `apps/admin-web/src/app/brands/page.tsx` + `actions.ts` (new) — same table pattern, flatter (no
   parent/hierarchy), create/rename/delete.
5. **Upgrade T5.1's product editor** (`apps/admin-web/src/components/products/product-organization-
   card.tsx`): replace the plain-text brand id / category ids inputs with real pickers now backed
   by `fetchBrandsPage`/`fetchCategoriesPage` (a `<select>` for brand, a checklist for categories —
   simple client-side fetch-on-mount or pass the list down from the server component parent, your
   call). This closes the loop the T5.1 BLOCKERS.md entry left open — update that entry (or add a
   short "resolved by T5.7" note to it) once done.
6. **Navigation**: add `categories` and `brands` entries to `PRIMARY_NAV` (or fold both under one
   "Catalog" grouping if `navigation.ts` supports groups — check its existing structure first and
   match whatever pattern is already there, do not invent a new nav shape).
7. **`middleware.ts`**: `["/categories", "viewer"]` and `["/brands", "viewer"]` for the list view
   (read-only browsing), matching `/products`'s pattern — the create/move/delete forms are on the
   same page and are independently permission-gated server-side, same precedent as T5.1/T5.2.
8. Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (apply to every Phase 5 admin task)

1. `packages/*`/`services/*` never import from `apps/*`. The backend addition here stays inside
   `services/catalog` and `apps/admin` only — do not add any new cross-boundary import.
2. Domain aggregates never go on the wire — this task's entire backend half exists to fix exactly
   that violation for categories/brands; do not introduce a new one for either DTO.
3. Never fabricate data in the UI.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark this task's checkbox (`- [ ] **T5.7 Categories and brands.**` → `- [x] ...`) when done.
8. One `Idempotency-Key` per user-initiated submit.
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter @platform/catalog typecheck && pnpm --filter @platform/catalog test
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
pnpm arch
```

## Report

Write your full report to `docs/plans/.progress/task-T5.7-report.md`. Return to the controller
only: status, files changed (backend and frontend separately), one-line test summary per package,
concerns.
