# Task T5.15 brief — Storefront search

**Important correction to the plan text before you start.** The plan says this task "needs Phase
4 T4.3's `GET /search/indexes/:indexId/queries`" — that route does not exist as a GET; the only
`queries` route in `apps/admin/src/http/search-routes.ts` is `POST /search/indexes/:indexId/
queries`, and it only **logs** a query for analytics (`admin.search.logQuery`). The dedicated
Search bounded context (`services/search`) manages search-index **configuration**
(create/advance/upsert-document/delete-document/synonyms/suggestions) — it has **no capability
anywhere to execute a query and return matching documents**. Confirmed by reading
`services/search/src/interfaces/search.controller.ts` in full: `create`/`advance`/
`upsertDocument`/`deleteDocument`/`addSynonym`/`removeSynonym`/`addSuggestion`/`logQuery`/`list`/
`get` — no `search`/`query`/`execute` method exists. Building storefront search against this
context is not possible with what exists. **Add one `docs/plans/BLOCKERS.md` entry recording
this** (the Search context needs a real query-execution capability — index config without a query
executor is incomplete — before it can back a results page).

**The good news: real search is achievable a different way, already wired underneath.** The
**Catalog** context's `ListProducts` use case (`services/catalog/src/application/
list-products.use-case.ts`) already supports a `query?: string` parameter — "delegates to `search`
when a text `query` is given... a case-insensitive substring stopgap... the real ranked search
projection is the Search context's job, not a competitor built here" (its own doc comment).
`ProductController.list()` already accepts and forwards this field. The **admin** `GET /products`
route already exposes it (`listProductsQuery`, used by the existing Products screen). The
**public** `GET /public/products` route (`apps/admin/src/http/public-catalog-routes.ts`) does
**not** — its `pageQuery` has no `query` field. This is the one small, contained backend addition
this task needs (same class of change as T5.7's `GET /brands`/`GET /categories` fix): add
`query?: string.min(1)` to a public-facing query schema and thread it through. This gives the
storefront **real, substring-based product search** — honest about being a stopgap, not the
Search context's eventual ranked relevance, which is what the BLOCKERS.md entry above should make
clear is still missing.

## Backend step (small, contained — do this first)

1. In `apps/admin/src/http/public-catalog-routes.ts`, add a `query?: string.min(1)` field to the
   `GET /public/products` route's querystring schema (either extend the existing `pageQuery` used
   there, or add a route-specific one — check whether `pageQuery` is shared with other public
   routes that should NOT gain a `query` field, like categories/collections; if so, add a
   dedicated `publicProductsQuery` for this route only, do not widen a shared schema
   unnecessarily).
2. Update that route's `handle` to pass `query.query` through to `admin.publicReads.products.list(
   query)` — it already accepts the field, per `ListProductsInput`, no controller/use-case change
   needed.
3. Run `pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test` before
   moving to the frontend. Add a test for the new query param in whatever test file covers
   `public-catalog-routes.ts` (check for `public-catalog-routes.test.ts`).
4. Run `pnpm arch` (you touched `apps/admin`, not `services/*`, so this is likely unaffected, but
   confirm).

## Frontend — storefront

1. `apps/storefront/src/lib/api/` (find the existing pattern for reading public catalog data —
   check what's already there, e.g. a `products.ts` or `catalog.ts`) — add a `searchProducts`
   function calling `GET /public/products?query=...`, reusing whatever public-product DTO/fetch
   pattern already exists for the products listing (do not invent a new one).
2. A header search field, added to the storefront's shared layout/header component (find it —
   likely `apps/storefront/src/components/` has a header/nav component already, given
   `apps/cart`/`apps/checkout`/`apps/products`/`apps/collections` all exist and presumably share
   one), submitting to `/search?q=...`.
3. `apps/storefront/src/app/search/page.tsx` (new) — reads the `q` search param, calls
   `searchProducts`, renders results using whatever product-card component the existing
   products/collections listing already uses (reuse it, do not build a new one), with an explicit
   empty-results state and an explicit error state (never a blank page).

## Global constraints (Phase 5 storefront tasks)

1. `packages/*`/`services/*` never import from `apps/*`; the backend change here stays inside
   `apps/admin` only.
2. Domain aggregates never go on the wire — reuse the existing `toProductDto`/`PublicProductDto`
   mapping already used by `GET /public/products`, do not add a new leaky shape.
3. Never fabricate data — the BLOCKERS.md entry above is this rule applied to the Search context's
   missing capability; do not build a fake "smart search" UI implying ranked relevance that
   doesn't exist.
4. Every user-facing string in both of the storefront's dictionaries
   (`apps/storefront/src/messages/en.ts`/`ar.ts` — a separate pair from admin-web's).
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark this task's checkbox (`- [ ] **T5.15 Search.**` → `- [x] **T5.15 Search.**`) when done —
   include the BLOCKERS.md entry as a required part of "done."
8. N/A (read-only public search — no idempotency key needed, this is a GET).
9. The storefront may call the runtime API only from Server Components/Server Actions, same rule
   as admin-web — check `apps/storefront`'s existing pattern for how it does public GETs (likely
   simpler than admin-web's `getAdminApi`/`mutateAdminApi` since public routes need no auth token)
   and match it exactly, do not invent a new fetch layer.

## Verify

```bash
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm --filter storefront typecheck && pnpm --filter storefront lint && pnpm --filter storefront test
pnpm arch
```

## Report

Write your full report to `docs/plans/.progress/task-T5.15-report.md`. Return to the controller
only: status, files changed (backend and frontend separately), one-line test summary per package,
concerns.
