# Task T5.20 report — Collection member products at scale

## Status: DONE

## Summary

Replaced the storefront's "fetch the collection plus the whole catalog's first 100 products, then
intersect client-side" workaround (`resolveCollectionBySlug` in `apps/storefront/src/lib/
catalog.ts`) with a real, paginated, server-side "products in this collection" read path — a
collection member beyond the catalog's first 100 products (in whatever order the catalog's default
`list()` returns) no longer silently disappears from the collection page.

Read `services/catalog/src/application/get-collection-by-slug.use-case.ts`,
`collection.controller.ts`, `collection-repository.ts`, `product-repository.ts`,
`packages/repository/src/index.ts`, `packages/types/src/index.ts`, and the current (post-T5.15)
state of `apps/admin/src/http/public-catalog-routes.ts`, `apps/storefront/src/lib/runtime-api.ts`,
and `apps/storefront/src/lib/catalog.ts` in full before writing anything, per the brief's
instruction — confirmed `ProductRepository` has only single-item `findById` (no bulk lookup) and
`Collection` only stores an ordered `productIds: string[]` (no repository-level "products in this
collection" query), matching what the brief said to expect.

## Backend change (`services/catalog` + `apps/admin`)

**`services/catalog/src/application/list-collection-products.use-case.ts` (new)** — `ListCollectionProducts`:
- Input: `{ slug: string } & CursorPage`. Looks up the collection via `CollectionRepository.findBySlug`
  (same call `GetCollectionBySlug` makes) and returns a `NotFoundError` (same `err(new
  NotFoundError(...))` shape as `GetCollectionBySlug`) when the collection is missing **or not
  published** — the brief was explicit this use case 404s in both cases, unlike `GetCollectionBySlug`
  itself, which doesn't check status.
- Paginates the collection's own ordered `productIds` array **by index**: the cursor is the
  stringified array index of the last row the page consumed, round-tripped through
  `@platform/repository`'s `encodeCursor`/`decodeCursor` (the identity function today, same as every
  other cursor in the codebase — treated as opaque regardless). Page size goes through
  `normalizePageSize` (same `[1, 100]` clamp/default every other list use case in this package uses).
  This is a genuinely different cursor shape from `InMemoryCollectionRepository`'s `list()`/`search()`
  (which sort by id and cursor on the id), because the contract here is to preserve the collection's
  *curated* order, not re-sort — there is no existing helper to reuse for that, so this is new, matched
  to the existing primitives (`encodeCursor`/`decodeCursor`/`normalizePageSize`/`Paginated`) rather than
  inventing a new scheme.
- Bulk-resolves the page's id slice via parallel `ProductRepository.findById` calls (`Promise.all`,
  bounded by the page size).
- Drops two kinds of rows silently rather than erroring the whole page: an id that no longer resolves
  (stale/deleted product) and a product that resolves but isn't published (mirrors `publishedOnly`'s
  rule for `/public/prices`). Both filters run **after** the index slice, so `pageInfo` describes the
  raw slice of `productIds`, not the filtered result — a page can come back with fewer items than
  `first` while `hasNextPage` is still true, same documented caveat as `publishedOnly`.
- Preserves the collection's curated order in the result (no re-sorting).

**`services/catalog/src/application/list-collection-products.use-case.test.ts` (new)** — 7 tests:
not-found for missing slug, not-found for a draft collection, curated-order resolution, silently
skips a stale id, silently skips a non-published member, index-based cursor pagination (first page
`hasNextPage`/cursor correct, second page resumes and terminates correctly), and an empty-collection
page.

**`services/catalog/src/interfaces/collection.controller.ts`** — added `listCollectionProducts` to
`CollectionControllerDeps` and a new `listMemberProducts(input)` method, mirroring `getBySlug`'s
one-line `present(await this.deps.X.execute(input), 200)` shape exactly.

**`services/catalog/src/composition.ts`** — wired `listCollectionProducts: new
ListCollectionProducts({ collections, products })` into `buildControllers`'s `collectionController`,
same pattern as every other use-case wiring in that function.

**`apps/admin/src/http/public-catalog-routes.ts`** — added `GET /public/collections/:slug/products`:
`permission: "collections:read"` (same as the other two collection routes), `public: true`,
`schema: { params: slugParams, querystring: pageQuery }` (the same `{ params, querystring }` combo
`reviews-routes.ts`'s `GET /products/:productRef/reviews` already uses — not a new pattern), handler
merges `{ ...params, ...query }` and maps the result through the existing `toProductDto` (same DTO
`/public/products` and `/public/products/:slug` already use — no second product DTO invented) via
the existing `mapPage` helper.

**`apps/admin/src/http/public-catalog-routes.test.ts`** — added a `describe` block (4 tests): curated
order preserved end-to-end through the real `wireCatalog` composition (added to the collection in
reverse order, asserted the wire order matches), 404 for a nonexistent slug, 404 for an unpublished
collection, and a member product left in draft is silently absent from the response. Also updated
the "exposes exactly the N read routes" test from seven to eight routes.

## Frontend change (`apps/storefront`)

**`apps/storefront/src/lib/runtime-api.ts`**
- Added `CursorPageInfo`/`CursorPageResult<T>` and a `fetchPage<T>` helper — same fetch/parse/never-throw
  discipline as the existing `fetchList`, but preserves `pageInfo` (which `fetchList` discards) since a
  caller now needs to know whether more rows exist beyond a page, not just the items.
- Added `getCollectionProducts(slug, first?, after?)` calling the new route, returning
  `CursorPageResult<ProductSummary> | null`.
- `fetchList`/`fetchItem`/existing exports are unchanged — this task added alongside them rather than
  touching T5.15's generalized `fetchList` params handling.

**`apps/storefront/src/lib/catalog.ts`**
- `resolveCollectionBySlug(slug, after?)` — new optional `after` cursor parameter; return type gained
  a `pageInfo: CursorPageInfo` field on the `"ok"` branch.
- **Design decision (sequential, not parallel):** the old code fetched the collection and the product
  list in parallel because `getProducts()` always succeeds regardless of the collection's existence.
  The new paginated route itself 404s for a missing/unpublished collection, so probing it in parallel
  with the collection lookup would conflate "collection genuinely not found" with "the Runtime API
  call failed" (both currently collapse to `null` from the fetch helpers, with no status code
  surfaced to the caller). So collection lookup now runs first; the products page is only fetched once
  the collection is confirmed published. Documented in the function's own doc comment.
- **Design decision (page size / pagination UI):** brief asked for a judgment call on "one page with a
  'load more' control" vs. "the page component needs its own light pagination." Chose real forward
  pagination via a URL `?after=<cursor>` query param (`COLLECTION_PRODUCTS_PAGE_SIZE = 24`, exported
  from `catalog.ts`) rather than trying to fit everything on one request — a plain server-rendered
  "Next page" `<Link>`, matching the existing `search/page.tsx`'s `searchParams`-driven pattern (no
  client component, no JS-dependent "load more" state, shareable/bookmarkable URLs, works with JS
  disabled). No "previous page" link/control was added — the cursor route is forward-only (same as
  every other cursor-paginated route in this codebase), so a fabricated "previous" link was avoided;
  going back is a browser-back.

**`apps/storefront/src/lib/catalog.test.ts`**
- Added a `getCollectionProducts` mock (typed against `CursorPageResult<ProductSummary>`).
- Rewrote the `resolveCollectionBySlug` describe block (was 4 tests, now 6): resolves published
  members for one page + returns `pageInfo`; forwards page size and `after` cursor correctly; draft
  collection → not-found **without** calling the products route; nonexistent slug → not-found
  **without** calling the products route; error when the products page call fails. (Two of the "without
  calling" tests needed an explicit `getCollectionProducts.mockClear()` — this test file has no global
  `beforeEach(vi.clearAllMocks())`, and a mock's call history otherwise leaks across `it` blocks in the
  same file; localized `mockClear()` calls were used rather than adding a file-wide `beforeEach`, to
  keep the diff minimal and match the file's existing no-`beforeEach` convention.)

**`apps/storefront/src/app/collections/[slug]/page.tsx`**
- Added `searchParams: Promise<{ after?: string }>` (Next 15 promise-params convention, matching
  `search/page.tsx`), threaded `after` into `resolveCollectionBySlug(slug, after)`.
- Renders a "Next page" `<Link href="/collections/{slug}?after={cursor}">` when
  `pageInfo.hasNextPage && pageInfo.endCursor !== null`, with an `ArrowRightIcon` (RTL-flipped the
  same way the existing "back" link's `ArrowLeftIcon` is).
- The empty-state message is now cursor-aware: a genuinely-empty collection (first page, zero items)
  still shows `t.collection.empty`; a later page that comes back empty after the use case's own
  stale/unpublished filtering (while `hasNextPage` may still be true) shows a new, distinct
  `t.collection.emptyPage` string instead — avoiding the dishonest claim "this collection has no
  products" on a page that isn't actually the whole collection.

**`apps/storefront/src/messages/en.ts` / `ar.ts`**
- `collection.emptyPage` (new): "No products on this page." / "لا توجد منتجات في هذه الصفحة."
- `collection.nextPage` (new): "Next page" / "الصفحة التالية"
- Both added to `en.ts` (source of truth) and `ar.ts` (`const ar: Dictionary`) — typecheck passing
  confirms both are in sync (a key present in one but not the other is a compile error).

## Docs

- `docs/plans/PHASE-5-6-backlog.md` — `- [ ] **T5.20 Collection member products at scale.**` →
  `- [x] **T5.20 Collection member products at scale.**`.
- No `docs/plans/BLOCKERS.md` entry — nothing was genuinely blocked; both judgment calls above (fetch
  sequencing, pagination UI shape) were resolved and documented in code comments per the brief's own
  instruction to document judgment calls in this report, not treated as blockers.

## Verification (all commands run exactly as specified, in order, in one shell)

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter @platform/catalog typecheck   → clean (tsc --noEmit, no output = pass)
pnpm --filter @platform/catalog test        → 11 test files, 57 tests passed (includes the new
                                               list-collection-products.use-case.test.ts, 7 tests)
pnpm --filter @platform/admin typecheck     → clean (tsc --noEmit, no output = pass)
pnpm --filter @platform/admin test          → 40 test files, 269 tests passed (includes the
                                               expanded public-catalog-routes.test.ts, 12 tests,
                                               up from 7)
pnpm --filter storefront typecheck          → clean (tsc --noEmit, no output = pass)
pnpm --filter storefront lint               → clean (eslint ., no output = pass)
pnpm --filter storefront test               → 10 test files, 98 tests passed (catalog.test.ts went
                                               from 20 to 21 tests net — reworked
                                               resolveCollectionBySlug block: was 4 tests, now 6)
pnpm arch                                   → "no dependency violations found (1635 modules, 7460
                                               dependencies cruised)"
```

One earlier standalone run of `pnpm --filter @platform/admin test` (before the final combined run
above) showed 3 test files fail with `[vitest-worker]: Timeout calling "fetch"/"resolveId"` on
files this task never touched (`admin-http.e2e.test.ts`, `payments-webhook.e2e.test.ts`,
`financial-security-remediation.e2e.test.ts`) — worker-pool resource contention under a long
concurrent run, not an assertion failure. Re-ran immediately after: all 40 files / 269 tests passed
clean, and the same 3 files passed clean again inside the final combined verification run captured
above. Treated as environment flakiness, not a regression from this change — noted here rather than
in `BLOCKERS.md` since it self-resolved and isn't attributable to this task's diff.

No `git` commands were run anywhere in this task (the repo has no `.git`, per the environment note).

## Files changed

**Backend:**
- `services/catalog/src/application/list-collection-products.use-case.ts` (new)
- `services/catalog/src/application/list-collection-products.use-case.test.ts` (new)
- `services/catalog/src/interfaces/collection.controller.ts`
- `services/catalog/src/composition.ts`
- `apps/admin/src/http/public-catalog-routes.ts`
- `apps/admin/src/http/public-catalog-routes.test.ts`

**Frontend:**
- `apps/storefront/src/lib/runtime-api.ts`
- `apps/storefront/src/lib/catalog.ts`
- `apps/storefront/src/lib/catalog.test.ts`
- `apps/storefront/src/app/collections/[slug]/page.tsx`
- `apps/storefront/src/messages/en.ts`
- `apps/storefront/src/messages/ar.ts`

**Docs:**
- `docs/plans/PHASE-5-6-backlog.md`

## Concerns / notes for the controller

- Not verified in a live browser — same standing environment limitation every earlier Phase 4/5
  task's report notes (no Docker available in this session, so `apps/runtime` + `apps/storefront`
  can't be run together end-to-end). Verified at the code/typecheck/lint/test level only.
- The new use case's `hasNextPage`/`pageInfo` semantics intentionally describe the *raw* index slice
  of `productIds`, not the post-filter item count — this is a deliberate, documented consequence of
  filtering after slicing (matches the existing `publishedOnly` contract for `/public/prices`), but it
  means a shopper could in principle click "Next page" and land on a page that renders zero product
  cards (if every id in that particular slice happens to be stale/unpublished) while still showing a
  further "Next page" link. Handled honestly (a distinct `emptyPage` message, not a fabricated "no more
  products" claim) rather than trying to eagerly skip ahead across pages to guarantee a non-empty page,
  which would have meant either unbounded lookahead fetching or breaking the simple index-cursor
  contract.
- `COLLECTION_PRODUCTS_PAGE_SIZE = 24` was chosen as a reasonable product-grid page size; the brief
  didn't specify one. Easy to change in one place (`apps/storefront/src/lib/catalog.ts`) if a different
  value is wanted.
