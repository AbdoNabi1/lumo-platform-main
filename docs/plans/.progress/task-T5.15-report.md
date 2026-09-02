# Task T5.15 report — Storefront search

## Status: DONE

## Summary

The plan's own T5.15 note pointed at a route (`GET /search/indexes/:indexId/queries`) that does
not exist and, per the brief's correction, was never buildable as a real query-execution endpoint —
the dedicated Search bounded context (`services/search`) manages index **configuration** only
(create/advance/upsert-document/delete-document/synonyms/suggestions/list/get), with no
`search`/`query`/`execute` method anywhere on `SearchController` and no `query` method on
`IndexProviderPort`. Re-read `services/search/src/interfaces/search.controller.ts` in full to
confirm this myself before writing anything, as instructed — confirmed, and it matches what
`docs/plans/BLOCKERS.md`'s existing T4.3 entry already found for Phase 4.

Real search was built instead against Catalog's already-existing substring search: `ListProducts`
(`services/catalog/src/application/list-products.use-case.ts`) already accepts an optional
`query?: string` and delegates to a case-insensitive substring match over product name/sku when
given. The admin `GET /products` route already threaded this through; the public
`GET /public/products` route did not. This task added that one field to the public route (the
"one small, contained backend addition" the brief specified) and built the storefront's search
field + `/search` results page on top of it.

A `docs/plans/BLOCKERS.md` entry (`## T5.15 — ...`) records the Search context's missing
query-execution capability, and the Phase 5/6 backlog's T5.15 checkbox is marked `[x]`.

## Backend change (contained, `apps/admin` only)

**`apps/admin/src/http/public-catalog-routes.ts`**
- Added a route-scoped `publicProductsQuery` schema: `pageQuery.extend({ query: z.string().min(1).optional() })`.
  Kept separate from the shared `pageQuery` (used by categories/collections/prices/inventory, none
  of which have a query-aware `list()` use case) so those routes don't silently accept and drop an
  unsupported `query` param — per the brief's explicit instruction to check this before widening a
  shared schema.
- `GET /public/products`'s `schema.querystring` now uses `publicProductsQuery` instead of `pageQuery`.
- No handler-body change was needed: the existing handler already forwards the whole `query` object
  to `admin.publicReads.products.list(query)`, and `ListProductsInput` already declares
  `query?: string` — the field just needed to survive schema validation on the public route.
- Updated the route's `summary` doc string to mention the optional substring search.

**`apps/admin/src/http/public-catalog-routes.test.ts`**
- Added one test: `"T5.15: forwards a \`query\` querystring param to the substring product search"`
  — creates two products ("Wooden Building Blocks", "Metal Car"), invokes the route handler with
  `query: { query: "wooden" }`, and asserts only the matching product's slug comes back.

## Frontend change (`apps/storefront`)

Read `apps/storefront/src/lib/runtime-api.ts` and `lib/catalog.ts` in full first, per the brief's
instruction, before writing anything — these are the storefront's actual public-GET pattern (there
is no `lib/api/` directory in this app, contrary to the plan text's guess; `lib/runtime-api.ts` is
the low-level fetch layer, `lib/catalog.ts` is the higher-level "published only" resolution layer
on top of it).

**`apps/storefront/src/lib/runtime-api.ts`**
- Generalized the internal `fetchList<T>(path, first?)` helper to `fetchList<T>(path, params?: Record<string, string | number>)`
  so it can build a querystring from more than just `first` (needed for `query` + `first` together).
  Updated all five existing callers (`getProducts`, `getCollections`, `getPrices`, `getInventory`,
  and the no-param `getCategories`) to the new call shape — behavior unchanged for all of them.
- Added `searchProducts(query: string, first = MAX_PAGE_SIZE)`, calling the same
  `GET /public/products` route and the same `ProductSummary` DTO as `getProducts`, just with the new
  `query` param — per the brief's "reuse whatever public-product DTO/fetch pattern already exists,
  do not invent a new one."

**`apps/storefront/src/lib/catalog.ts`**
- Added `searchPublishedProducts(query: string): Promise<ProductListResult>` — calls
  `searchProducts`, then filters to `status === "published"` the same way `listPublishedProducts`
  does. The public route returns every status regardless of query match, so this boundary is
  necessary: a draft/scheduled/archived product must never surface in search results just because
  its name matched.

**`apps/storefront/src/lib/catalog.test.ts`**
- Added a `searchProducts` mock and a `searchPublishedProducts` describe block (2 tests): keeps only
  published matches, and surfaces `"error"` (never demo/fabricated data) when the API call fails —
  mirroring the existing `listPublishedProducts` test pattern exactly.

**`apps/storefront/src/components/site-header.tsx`**
- Added a search field to the shared header (used by every storefront page). It's a plain
  `<form action="/search" method="get" role="search">` with a visually-hidden `<Label>` and a
  `type="search"` `<Input>` named `q` — no `"use client"`, no debounce, no browser-side runtime-API
  call. `SiteHeader` is a Server Component; per the brief's constraint 9 ("the storefront may call
  the runtime API only from Server Components/Server Actions... likely simpler than admin-web's"),
  a plain GET form that Next's router turns into a `/search?q=...` navigation is the correct match
  for that constraint, not the client-side debounced `?q=`-pushing pattern `admin-web`'s
  `CustomersToolbar` uses (that pattern exists because `admin-web`'s customer list re-fetches
  in-place; the storefront's search is a full page navigation).

**`apps/storefront/src/app/search/page.tsx` (new)**
- Async Server Component reading `searchParams: Promise<{ q?: string }>` (Next 15 promise-params
  convention, matching `collections/[slug]/page.tsx` and `products/[slug]/page.tsx`).
- Three explicit states, never a blank page:
  1. **Prompt** — no query given (`q` missing or blank after trim): `StatePanel` with a search icon
     inviting the shopper to search.
  2. **Error** — `searchPublishedProducts` returns `{status:"error"}` (the catalog call failed):
     `StatePanel` with the same error treatment `products/[slug]/page.tsx` and
     `collections/[slug]/page.tsx` use.
  3. **Empty results** — a real query with zero published matches: an inline card (same pattern as
     the collection page's empty-members state) naming the query, not a full-page error.
  4. **Results** — reuses the existing `ProductCard` component and `PriceBook`/`AvailabilityBook`
     resolution, identical to how the home page and collection page render their product grids — no
     new product-rendering code was written.

**`apps/storefront/src/messages/en.ts` / `ar.ts`**
- `nav`: added `searchLabel`, `searchPlaceholder`, `searchSubmit`.
- New `search` section: `promptTitle`, `promptBody`, `resultsTitle`, `resultsCount`, `emptyTitle`,
  `emptyBody`, `errorTitle`, `errorBody`, `backToShop`. `ar.ts` is typed against `en.ts`'s
  `Dictionary` (`export const ar: Dictionary = {...}`), so a missing key would be a compile error —
  typecheck passing confirms both dictionaries are in sync.

## Docs

- `docs/plans/BLOCKERS.md` — new `## T5.15 — Storefront search built against Catalog's substring
  search, not the Search context (which still has no query-execution capability at all)` entry,
  cross-referencing and re-confirming the existing T4.3 entry, and recording the ruling made here.
- `docs/plans/PHASE-5-6-backlog.md` — `- [ ] **T5.15 Search.**` → `- [x] **T5.15 Search.**`.

## Verification (all commands run exactly as specified, in order)

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter @platform/admin typecheck   → clean (tsc --noEmit, no output = pass)
pnpm --filter @platform/admin test        → 40 test files, 265 tests passed (includes the new
                                             public-catalog-routes.test.ts case)
pnpm --filter storefront typecheck        → clean (tsc --noEmit, no output = pass)
pnpm --filter storefront lint             → clean (eslint ., no output = pass)
pnpm --filter storefront test             → 10 test files, 97 tests passed (catalog.test.ts went
                                             from 18 to 20 tests: the new searchPublishedProducts
                                             describe block)
pnpm arch                                 → "no dependency violations found (1634 modules, 7450
                                             dependencies cruised)" — this only cruises
                                             packages/services, not apps/*, so the apps/admin and
                                             apps/storefront changes were never in its scope; run to
                                             confirm as instructed, no regression.
```

No `git` commands were run anywhere in this task (the repo has no `.git`, per the environment note).

## Files changed

**Backend:**
- `apps/admin/src/http/public-catalog-routes.ts`
- `apps/admin/src/http/public-catalog-routes.test.ts`

**Frontend:**
- `apps/storefront/src/lib/runtime-api.ts`
- `apps/storefront/src/lib/catalog.ts`
- `apps/storefront/src/lib/catalog.test.ts`
- `apps/storefront/src/components/site-header.tsx`
- `apps/storefront/src/app/search/page.tsx` (new)
- `apps/storefront/src/messages/en.ts`
- `apps/storefront/src/messages/ar.ts`

**Docs:**
- `docs/plans/BLOCKERS.md`
- `docs/plans/PHASE-5-6-backlog.md`

## Concerns / notes for the controller

- Search is a **substring stopgap over Catalog**, explicitly not ranked relevance — this is by
  design per the brief and is stated in code comments, the BLOCKERS.md entry, and would be visible
  to a shopper only as "results contain the term," never a smarter ranking. No UI copy implies
  otherwise.
- Not verified in a live browser (same standing environment limitation every earlier phase's
  BLOCKERS.md entries note: no Docker available in this session, so `apps/runtime` +
  `apps/storefront` can't be run together end-to-end). Verified at the code/typecheck/lint/test
  level only, consistent with how every other Phase 4/5 task in this environment was verified.
- `fetchList`'s signature change (from `first?: number` to `params?: Record<string,string|number>`)
  touches all five existing public-list callers in `runtime-api.ts`. All five are behaviorally
  unchanged (verified by the unchanged `catalog.test.ts` assertions for `listPublishedProducts`/
  `listPublishedCollections`/`PriceBook`/`AvailabilityBook`, which mock at the `runtime-api`
  function boundary, not `fetchList` itself, so this internal refactor is fully covered).
