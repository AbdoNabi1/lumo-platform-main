# Task T5.1 brief — Product editor, complete

Extracted/expanded from docs/plans/PHASE-5-6-backlog.md's T5.1 and the write recipe in
apps/admin-web/README.md ("Adding a write screen"). Read the README section first, or follow the
condensed version below — it is the exact recipe every write screen in this app follows.

## Method (write-screen recipe, condensed from apps/admin-web/README.md)

For each route:

1. Find it in `apps/admin/src/http/admin-routes.ts` (already located for you below — path, method,
   `permission`, `idempotent`, zod body). These four facts are the contract.
2. Add a typed function to `apps/admin-web/src/lib/api/products.ts`, calling
   `mutateAdminApi(path, { method, body, idempotencyKey }, isValid)` from `lib/api/client.ts`.
   Type only the fields you actually read off the response.
3. Add a `"use server"` action in `apps/admin-web/src/app/products/actions.ts` (existing file —
   append to it, do not replace `createProductAction`/`updateProductAction`). It must: parse
   `FormData` itself defensively; call `newIdempotencyKey()` exactly once per invocation; call the
   `lib/api/products.ts` function; on `ok`, `revalidatePath("/products")` and
   `revalidatePath("/products/${productId}")`; on anything else, `return toFormState(result, t)`.
4. Add/extend a `"use client"` form using `useActionState(actionFn, { status: "idle" })`, rendering
   `state.fieldErrors[name]` under the matching input with `aria-invalid`/`aria-describedby`, and
   disabling submit while `isPending` via `Button`'s `loading` prop.
5. Add every new string to **both** `apps/admin-web/src/messages/en.ts` and `.../ar.ts`. `en.ts` is
   the source of truth (`Dictionary` is inferred from it) — a key added there and not in `ar.ts` is
   a type error.
6. `middleware.ts`'s `ROUTE_ROLE_REQUIREMENTS` already has `["/products", "operator"]` or similar —
   verify it still covers `/products/[productId]` at the right role; do not lower it.

**Never** send a client-supplied price/amount without going through the form fields the operator
actually typed — the backend re-derives nothing here (these are catalog writes, not pricing
resolution), but never invent a value the operator did not enter.

## Existing state — read this before writing anything

Phase 1 (T1.3/T1.4) already built:

- `apps/admin-web/src/lib/api/products.ts` — `createProduct`, `updateProduct` (name/slug),
  `fetchProductsPage`, `fetchProduct` (returns the **full** `ProductDetailDto`: variants, options,
  seoTitle/Description, brandId, categoryIds, mediaAssetIds — everything you need to render forms,
  no new GET work required for this task), `fetchProductInventory`.
- `apps/admin-web/src/app/products/actions.ts` — `createProductAction`, `updateProductAction`.
  Read this file fully: it shows the exact `FormData`-parsing and idempotency-key pattern to copy
  for every new action below (see `parseVariants` for the array-field pattern you'll reuse for
  variant/option/category forms).
- `apps/admin-web/src/app/products/[productId]/page.tsx` — the detail screen. Currently renders
  four **read-only** cards: `ProductVariantsCard`, `ProductInventoryCard` (Suspense-streamed),
  `ProductOrganizationCard` (brand/categories/options), `ProductMediaSeoCard` (media + SEO), plus
  the existing `ProductEditForm` (name/slug) in a side card. Read all four card components under
  `apps/admin-web/src/components/products/` before changing them — this task turns each read-only
  card into one that also exposes the write actions below, without breaking its existing display
  logic or its existing tests.
- Publish/schedule/unpublish/archive/delete and variant add/remove have **no** UI at all yet — add
  a lifecycle action bar (e.g. above or beside `ProductStatusBadge` in `page.tsx`) with buttons
  gated by product status (do not offer "Publish" on an already-published product, etc. — read
  `ProductStatusBadge`'s status list and `admin-routes.ts`'s handlers to know which transitions
  make sense; if the backend rejects an invalid transition it will return a normal `MutationResult`
  error, but the UI should not offer obviously-wrong actions).

## Routes — all in `apps/admin/src/http/admin-routes.ts`, lines ~707-938

| Route | Method | Permission | Idempotent | Body (zod, verbatim) |
| --- | --- | --- | --- | --- |
| `/products/:productId/publish` | POST | `products:publish` | yes | none (params only) |
| `/products/:productId/schedule-publish` | POST | `products:publish` | yes | `{ scheduledAt: z.coerce.date() }` |
| `/products/:productId/unpublish` | POST | `products:publish` | yes | none |
| `/products/:productId/archive` | POST | `products:update` | yes | none |
| `/products/:productId/delete` | POST | `products:delete` | yes | none |
| `/products/:productId/variants` | POST | `products:update` | yes | `{ sku: string.min(1), priceAmountMinor: number.int().positive(), currency: string.length(3), selection?: Record<string,string> }` |
| `/products/:productId/variants/:variantId/remove` | POST | `products:update` | yes | none |
| `/products/:productId/variants/:variantId` | POST | `products:update` | yes | `{ sku: string.min(1), priceAmountMinor: number.int().positive(), currency: string.length(3) }` (edit) |
| `/products/:productId/options` | POST | `products:update` | yes | `{ options: Array<{ name: string.min(1), values: string[].min(1) }> }` — **replaces the whole set** (draft only — the route summary says so; the backend will reject on a published product, surface that error via `toFormState`, don't pre-block it client-side unless `product.status` is easily checked) |
| `/products/:productId/seo` | POST | `products:update` | yes | `{ title?: string.min(1), description?: string.min(1) }` |
| `/products/:productId/brand` | POST | `products:update` | yes | `{ brandId: string.min(1) \| null }` |
| `/products/:productId/categories` | POST | `products:update` | yes | `{ categoryIds: string[] }` — full replace |
| `/products/:productId/media` (attach) | POST | `products:update` | yes | `{ assetId: string.min(1) }` |
| `/products/:productId/media/:assetId` (detach) | DELETE | `products:update` | yes | none |
| `/products/:productId/media` (reorder) | PUT | `products:update` | yes | `{ assetIds: string[] }` — full order |

That is 15 write endpoints (the plan's summary says "20 routes" counting the 5 already-shipped
GET/create/update-name-slug routes from Phase 1 among the 20 total under `/products` — this task
covers the 15 not yet wired).

`variantIdParams = { productId, variantId }`. `assetIdParams = { productId, assetId }`.

For brand/category **selection UI**: there is no `GET /brands` or category-tree endpoint wired
into a picker component yet in this codebase for this purpose — check
`apps/admin-web/src/lib/api/` for an existing `brands.ts`/categories fetch (T5.7 in this same
phase owns building full brand/category CRUD screens; if no fetch-list function exists yet, add
the minimal read-only `fetchBrands`/`fetchCategories` list calls you need for the picker here,
scoped to what a `<select>`/checklist needs — do not build T5.7's full CRUD screens, just enough
to populate this product's brand dropdown and category checklist. `GET /categories` is
`listCategoriesQuery = { first?, after? }`, permission `categories:read`. If a brands list GET
route is not visible in `admin-routes.ts`, note it in `docs/plans/BLOCKERS.md` and render the
brand field as a plain text input for the brand id instead — do not block the rest of the task on
a missing list endpoint).

## Media attach

There is no asset picker/upload flow in scope here — `attachMedia` takes a raw `assetId`. Render a
plain text input for the asset id (operators already have ids from the Media Library screen,
`apps/admin-web/src/app/media` if it exists, or T3.6's download-link work) — do not build an
upload widget, that is out of scope for this task.

## Acceptance

All 15 routes above are reachable from `/products/:productId`. Every mutation follows the FormData
→ Server Action → typed API function → `mutateAdminApi` chain with one idempotency key per submit.
No client-side price/amount is fabricated. Product lifecycle buttons are gated by current status so
the UI never offers a transition the state machine cannot take from where the product is now (best
effort from `ProductStatusBadge`'s known statuses — a hard backend rejection surfacing as a form
error is acceptable for edge cases, it must simply never be silently swallowed).

## Global constraints (apply to every Phase 5 admin task)

1. `packages/*` and `services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire — every DTO stays hand-typed to primitive fields.
3. Never fabricate data in the UI — explicit unavailable/empty/error states only.
4. Every user-facing string goes in both `messages/en.ts` and `messages/ar.ts`.
5. Do not run `git` commands — this working copy is not a git repository.
6. Do not ask questions. If genuinely blocked, append an entry to `docs/plans/BLOCKERS.md` in the
   shape at the bottom of `docs/plans/README.md`, skip just that piece, continue the rest.
7. Mark this task's checkbox (`- [ ] **T5.1 Product editor, complete.**` →
   `- [x] **T5.1 Product editor, complete.**`) in `docs/plans/PHASE-5-6-backlog.md` when done.
8. One `Idempotency-Key` per user-initiated submit, minted once in the action.
9. Never call the runtime API from browser JS — every fetch happens server-side.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Repo root: `D:\lumo-platform-main-main\lumo-platform-main-main`. Windows host — root-level
`turbo`/`pnpm typecheck` is known broken in this environment (`docs/plans/BLOCKERS.md`); use the
`--filter admin-web` commands above directly.

## Report

Write your full report to
`docs/plans/.progress/task-T5.1-report.md`. Return to the controller only: status
(DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED), files changed, a one-line test summary (pass
count), and any concerns.
