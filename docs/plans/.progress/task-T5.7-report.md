# Task T5.7 report — Categories and brands

## Status: DONE

Both halves of the brief are complete: the backend vertical slice (ListBrands use case,
BrandController.list, GET /brands route, DTO mappers for both GET /categories and GET /brands) and
the frontend (categories/brands API clients, list screens with inline create/move/delete, the
ProductOrganizationCard picker upgrade, nav, middleware, and both locale dictionaries).

## Backend steps followed (in order, per the brief)

1. `services/catalog/src/application/list-brands.use-case.ts` (new) — `ListBrands`, copied from
   `list-categories.use-case.ts`'s shape verbatim (`Brand`/`BrandRepository`/`brands`).
2. `services/catalog/src/interfaces/brand.controller.ts` — added `listBrands: ListBrands` to
   `BrandControllerDeps` and a `list(input: CursorPage)` method mirroring
   `category.controller.ts`'s `list`.
3. `services/catalog/src/composition.ts` — added `listBrands: new ListBrands({ brands })` to the
   `BrandController` constructor call (next to `categoryController`'s `listCategories`).
4. `apps/admin/src/interfaces/products.admin-controller.ts` — added `listBrands`, guarding
   `"brands:read"`, delegating to `this.brands.list(input)` — mirrors `listCategories` exactly.
5. `apps/admin/src/http/admin-routes.ts`:
   - Added `CategoryDto`/`BrandDto` interfaces and `toCategoryDto`/`toBrandDto` mapper functions
     next to the product DTO mappers. Read `category.ts`/`brand.ts` fully first, per the brief's
     instruction — `Category` exposes `id`/`name`/`slug` (a `Slug` value object, `.value` read
     off it)/`parentId` (already a plain `string | null`); `Brand` exposes `id`/`name`/`slug`.
     Neither mapper includes `deleted` — confirmed both `PrismaCategoryRepository`/
     `PrismaBrandRepository`'s `list()` (via `deletedAt: null` in the Prisma `where`) and both
     in-memory repositories' `list()` (via an explicit `.filter((x) => !x.deleted)`) already
     exclude soft-deleted rows, so no extra filtering was needed in the mapper.
   - Changed `GET /categories`'s `handle` to `mapPage(await admin.products.listCategories(...),
     toCategoryDto)`, same `mapPage` helper `GET /products` already uses.
   - Added `GET /brands`: `permission: "brands:read"`, reusing `listCategoriesQuery`'s
     `{ first?, after? }` shape (no new zod const, per the brief), `handle` calling
     `admin.products.listBrands(...)` through `mapPage`/`toBrandDto`.
6. Ran the catalog and admin verification commands after the backend changes, before starting the
   frontend (see Verification below) — both were clean before any frontend file was touched.
7. Added tests: `services/catalog/src/application/list-brands.use-case.test.ts` (new, mirrors
   `get-collection-by-slug.use-case.test.ts`'s style — no pre-existing `list-categories.use-case`
   test existed to copy) and a new `describe("GET /categories (list) and GET /brands (list)", ...)`
   block in `apps/admin/src/http/admin-http.e2e.test.ts` (mirrors the existing `GET /products
   (list)` block: auth-required check, then create-then-list-as-flat-DTO for each).

Scope was kept exactly to what the brief specified — no other file under `services/catalog` was
touched, and no new cross-boundary import was added (`packages/*`/`services/*` still never import
from `apps/*`).

## Frontend built

1. `apps/admin-web/src/lib/api/categories.ts` (new) — `fetchCategoriesPage`, `createCategory`,
   `moveCategory`, `deleteCategory`, following `products.ts`'s `ApiResult`/`isXPageDto` pattern.
2. `apps/admin-web/src/lib/api/brands.ts` (new) — `fetchBrandsPage`, `createBrand`, `updateBrand`,
   `deleteBrand`, same shape.
3. `apps/admin-web/src/app/categories/page.tsx` + `actions.ts`, plus
   `components/categories/{categories-table,categories-pagination,category-create-form}.tsx` — a
   flat, cursor-paginated table (reusing `products-table.tsx`/`products-pagination.tsx`'s
   structure) with a "Parent" column (resolved to the parent's name when it's on the current page,
   else its raw id) and inline create/move/delete. "Move" uses a `<select>` populated from the
   current page's categories (plus a "No parent" option), not a tree widget, per the brief.
4. `apps/admin-web/src/app/brands/page.tsx` + `actions.ts`, plus
   `components/brands/{brands-table,brands-pagination,brand-create-form}.tsx` — same pattern,
   flatter (no parent column), inline create/rename/delete.
5. **`ProductOrganizationCard` picker upgrade**
   (`apps/admin-web/src/components/products/product-organization-card.tsx`): the plain-text
   `brandId` input is now a real `<select>` and the comma-separated `categoryIds` input is now a
   real checklist, both populated from `brands`/`categories` props. Those lists are fetched
   server-side by the parent (`app/products/[productId]/page.tsx`, via `fetchBrandsPage`/
   `fetchCategoriesPage`, capped to the first 100) and passed down as plain DTO arrays — never
   fetched client-side, per the repo-wide "never call the runtime API from browser JS" rule. A
   currently-assigned id that isn't on that first page still renders as its own "unlisted" option
   so a save can never silently drop it. `app/products/actions.ts`'s
   `assignProductCategoriesAction` was updated to read the checklist's repeated `categoryIds`
   field via `stringFieldValues` (same technique `reorderProductMediaAction` already used for
   `assetIds`) instead of comma-splitting a single field; the now-unused `parseIdList` helper was
   removed. `setProductBrandAction` needed no change — a `<select>`'s empty-string value already
   maps through `optionalStringField` the same way a blank text input did.
6. **Navigation**: `navigation.ts`'s `PRIMARY_NAV` is a flat list (no group support exists, so no
   "Catalog" grouping was invented) — added `categories` and `brands` entries right after
   `products`, with `FolderTreeIcon`/`AwardIcon`.
7. **`middleware.ts`**: added `["/categories", "viewer"]` and `["/brands", "viewer"]` to
   `ROUTE_ROLE_REQUIREMENTS`, right after `/products`, matching its read-only-browsing precedent —
   the create/move/delete/rename forms on those pages are independently permission-gated
   server-side (`categories:create`/`update`/`delete`, `brands:create`/`update`/`delete`).
8. Every new string added to both `messages/en.ts` and `messages/ar.ts`: `nav.categories`/
   `nav.brands`, `categoriesPage`, `categoryCreateForm`, `categoryRowActions`, `brandsPage`,
   `brandCreateForm`, `brandRowActions`, and updated `productBrandForm`/`productCategoriesForm`
   (the old "no picker wired yet" hint strings were replaced with `none`/`unlistedOption`/
   `noCategoriesAvailable`, since the picker now exists).
9. `docs/plans/BLOCKERS.md`'s T5.1 entry got a "Resolved by T5.7" note; `docs/plans/
   PHASE-5-6-backlog.md`'s `- [ ] **T5.7 ...**` checkbox is now `- [x]`.

## Tests added

- `services/catalog/src/application/list-brands.use-case.test.ts` — 1 test.
- `apps/admin/src/http/admin-http.e2e.test.ts` — 3 new tests (auth-required on both routes,
  category list-as-DTO, brand list-as-DTO) in a new `describe` block.
- `apps/admin-web/src/lib/api/categories.test.ts` (new) — 7 tests.
- `apps/admin-web/src/lib/api/brands.test.ts` (new) — 6 tests.

No new component-level (`.test.tsx`) tests were added for the categories/brands table/form
components or the `ProductOrganizationCard` picker upgrade — the existing `.test.tsx` coverage
pattern in this repo (`product-lifecycle-actions.test.tsx`, `product-variants-card.test.tsx`, etc.)
targets components with materially conditional branching under test; the new table/form components
here are straightforward server-driven renders + `useActionState` forms with the same shape already
exercised by `product-lifecycle-actions.test.tsx`'s pattern. Flagging this as a judgment call, not
a hidden gap — happy to add them if the reviewer wants tighter coverage.

## Verification (all commands from the brief's "Verify" section, run in order)

```
pnpm --filter @platform/catalog typecheck   -> clean
pnpm --filter @platform/catalog test        -> 10 files / 50 tests passed (was 9 files / 49 before
                                                this task's list-brands.use-case.test.ts)
pnpm --filter @platform/admin typecheck     -> clean
pnpm --filter @platform/admin test          -> 40 files / 264 tests passed
pnpm --filter admin-web typecheck           -> clean
pnpm --filter admin-web lint                -> clean (1 pre-existing unrelated warning in
                                                next.config.ts, `require-await` on `headers()`)
pnpm --filter admin-web test                -> 48 files / 440 tests passed
pnpm arch                                   -> "no dependency violations found" (1634 modules,
                                                7450 dependencies cruised)
```

The catalog and admin backend commands were run and confirmed clean before any frontend file was
touched, per the brief's instruction not to let a backend break surface only at the end.

## Files changed

### Backend

- `services/catalog/src/application/list-brands.use-case.ts` (new)
- `services/catalog/src/application/list-brands.use-case.test.ts` (new)
- `services/catalog/src/interfaces/brand.controller.ts`
- `services/catalog/src/composition.ts`
- `apps/admin/src/interfaces/products.admin-controller.ts`
- `apps/admin/src/http/admin-routes.ts`
- `apps/admin/src/http/admin-http.e2e.test.ts`

### Frontend

- `apps/admin-web/src/lib/api/categories.ts` (new)
- `apps/admin-web/src/lib/api/categories.test.ts` (new)
- `apps/admin-web/src/lib/api/brands.ts` (new)
- `apps/admin-web/src/lib/api/brands.test.ts` (new)
- `apps/admin-web/src/app/categories/page.tsx` (new)
- `apps/admin-web/src/app/categories/actions.ts` (new)
- `apps/admin-web/src/app/brands/page.tsx` (new)
- `apps/admin-web/src/app/brands/actions.ts` (new)
- `apps/admin-web/src/components/categories/categories-table.tsx` (new)
- `apps/admin-web/src/components/categories/categories-pagination.tsx` (new)
- `apps/admin-web/src/components/categories/category-create-form.tsx` (new)
- `apps/admin-web/src/components/brands/brands-table.tsx` (new)
- `apps/admin-web/src/components/brands/brands-pagination.tsx` (new)
- `apps/admin-web/src/components/brands/brand-create-form.tsx` (new)
- `apps/admin-web/src/components/products/product-organization-card.tsx` (picker upgrade)
- `apps/admin-web/src/app/products/actions.ts` (`assignProductCategoriesAction` now reads a
  repeated field; `parseIdList` removed)
- `apps/admin-web/src/app/products/[productId]/page.tsx` (fetches brands/categories server-side,
  passes them to `ProductOrganizationCard`)
- `apps/admin-web/src/components/navigation.ts`
- `apps/admin-web/src/middleware.ts`
- `apps/admin-web/src/messages/en.ts`
- `apps/admin-web/src/messages/ar.ts`

### Docs

- `docs/plans/BLOCKERS.md` (T5.1 entry: resolution note appended)
- `docs/plans/PHASE-5-6-backlog.md` (T5.7 checkbox ticked)

## Concerns / judgment calls

- The brand/category pickers on `ProductOrganizationCard` and the category "move"/create parent
  `<select>` are capped to the first page (100 items for the product card, the current page — 20
  items — for the categories list screen's own create/move selects) of their respective lists. A
  search-as-you-type or "load more" picker was out of scope per the brief ("do not build a tree
  widget" for categories, and no larger picker infrastructure exists elsewhere in this repo to
  reuse). An id outside that window is still handled honestly (rendered as its own "unlisted"
  option on the product card; simply not offered as a move target on the categories list screen,
  which only causes an operator to need to use a different means to move into a category outside
  the first page — a pagination-shaped limitation, not a data-loss risk).
- No component-level tests were added for the six new list-screen components or the
  `ProductOrganizationCard` picker upgrade (see "Tests added" above for the reasoning) — this is a
  scope judgment call, flagged for visibility rather than silently skipped.
- `docs/plans/.progress/phase5-ledger.md` was intentionally left untouched — its existing T5.5/T5.6
  entries read as an independent reviewer's re-verification notes, not something the task
  implementer fills in; the brief's own file list for this task doesn't mention it.
