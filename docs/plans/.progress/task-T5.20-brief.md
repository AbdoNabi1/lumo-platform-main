# Task T5.20 brief — Collection member products at scale

Confirmed root cause (already researched — verify, don't re-derive): `apps/storefront/src/lib/
catalog.ts`'s `resolveCollectionBySlug` fetches the collection (`getCollectionBySlug`, gives the
curated, ordered `productIds` array) and **the whole product catalog's first page**
(`getProducts()`, capped at `MAX_PAGE_SIZE = 100` in `apps/storefront/src/lib/runtime-api.ts`),
then intersects them client-side. Any collection member product beyond the catalog's first 100
products (by whatever order the backend's default `list()` returns) silently never appears in the
collection page — not an error, just missing, which is worse. This task replaces that
intersect-with-a-capped-list approach with a real, paginated, server-side "products in this
collection" endpoint.

## Backend: a small, contained vertical slice (same class of addition as T5.7's `GET /brands`)

`services/catalog`'s `ProductRepository` has `findById` (single item, no bulk lookup) and `list`/
`search` (unfiltered by collection). `CollectionController` (`services/catalog/src/interfaces/
collection.controller.ts`) has `getBySlug`/`list`/write methods, no member-products read. Add:

1. **`services/catalog/src/application/list-collection-products.use-case.ts`** (new) — takes
   `{ slug: string } & CursorPage`, looks up the collection by slug (reuse
   `CollectionRepository.findBySlug`, same as `GetCollectionBySlug`), 404s if missing or not
   published (mirror `GetCollectionBySlug`'s `NotFoundError` pattern — read that use case in full
   first, copy its shape), then paginates over the collection's own **ordered** `productIds` array
   using simple index-based cursor slicing (the cursor encodes a position in that array — do not
   invent a new cursor scheme, look at how `CursorPage`/`Paginated` are used elsewhere in this
   package first and match it, e.g. `packages/repository`'s in-memory cursor helper if one is
   exported for reuse), then bulk-resolves that page's slice of ids via `ProductRepository.findById`
   (parallel `Promise.all`, bounded by the page size — default/max is whatever `CursorPage`'s
   `first` already caps elsewhere in this codebase, likely 100), filtering out any id that no
   longer resolves (a product could have been deleted after being added to the collection — skip
   it silently, do not error the whole page for one stale reference) and any non-published product
   (the public surface must never leak drafts, same rule `publishedOnly` already enforces for
   prices in `public-catalog-routes.ts` — read that function for the pattern). Preserve the
   collection's curated order in the result.
2. **`services/catalog/src/interfaces/collection.controller.ts`** — add a `listMemberProducts`
   method mirroring `getBySlug`'s shape, delegating to the new use case.
3. **`services/catalog/src/composition.ts`** — wire the new use case into `collectionController`'s
   constructor call, same pattern as every other use-case wiring in that file.
4. **`apps/admin/src/http/public-catalog-routes.ts`** — add `GET /public/collections/:slug/
   products` (cursor-paginated querystring, same `pageQuery` shape as the file's other list
   routes), `permission: "collections:read"`, `public: true`, mapping the result through the
   existing `toProductDto` (same product DTO the `/public/products` route already uses — do not
   invent a second product DTO shape).
5. Run `pnpm --filter @platform/catalog typecheck && pnpm --filter @platform/catalog test` and
   `pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test` before moving
   to the frontend. Write a test for the new use case (co-located, mirror `get-collection-by-slug`
   test style if one exists) and for the new route (`public-catalog-routes.test.ts`). Run
   `pnpm arch` (you touched `services/catalog`).

## Frontend: `apps/storefront`

1. `apps/storefront/src/lib/runtime-api.ts` — add a `getCollectionProducts(slug, first, after)`
   function calling the new route, matching `getProducts`'s existing fetch-and-parse pattern.
2. `apps/storefront/src/lib/catalog.ts`'s `resolveCollectionBySlug` — stop calling `getProducts()`
   and intersecting; call the new paginated endpoint instead. Decide (your judgment, document it
   in your report) whether the collection page shows one page with a "load more"/pagination
   control, or whether the existing page component expects a flat list and needs its own light
   pagination UI added — check `apps/storefront/src/app/collections/[slug]/page.tsx`'s current
   rendering first, change only what's needed to support paginated results honestly (no silent
   truncation, no fabricated "that's everything" when more pages exist).
3. Update `apps/storefront/src/lib/catalog.test.ts`'s existing `resolveCollectionBySlug` tests for
   the new data-fetching shape — don't delete coverage, adapt it.

## Global constraints (Phase 5 storefront/backend tasks)

1. `packages/*`/`services/*` never import from `apps/*`. The backend addition here stays inside
   `services/catalog` and `apps/admin` only.
2. Domain aggregates never go on the wire — reuse the existing `toProductDto` mapper, do not
   return a `Product` aggregate or invent a second DTO.
3. Never fabricate data — a stale/deleted member id is silently skipped (per step 1 above), never
   rendered as a broken card or a fake placeholder.
4. Every new/changed user-facing string in both storefront dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark this task's checkbox (`- [ ] **T5.20 Collection member products at scale.**` →
   `- [x] ...`) when done.
8. N/A (read-only).
9. The storefront calls the runtime API only from Server Components/Server Actions, same as the
   rest of `apps/storefront` — match the existing `runtime-api.ts` pattern exactly.

## Verify

```bash
pnpm --filter @platform/catalog typecheck && pnpm --filter @platform/catalog test
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm --filter storefront typecheck && pnpm --filter storefront lint && pnpm --filter storefront test
pnpm arch
```

## Report

Write your full report to `docs/plans/.progress/task-T5.20-report.md`. Return to the controller
only: status, files changed (backend and frontend separately), one-line test summary per package,
concerns.
