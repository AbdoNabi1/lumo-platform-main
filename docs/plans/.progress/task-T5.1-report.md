# Task T5.1 report — Product editor, complete

Status: **DONE**

## What was built

All 15 not-yet-wired write routes under `/products` (`admin-routes.ts` lines ~707-938) are now
reachable from `/products/:productId`, following the exact recipe in `apps/admin-web/README.md`
("Adding a write screen") and the existing `createProductAction`/`updateProductAction` /
`ProductEditForm` reference implementations.

Routes wired: `publish`, `schedule-publish`, `unpublish`, `archive`, `delete`, `variants` (add),
`variants/:variantId/remove`, `variants/:variantId` (edit), `options` (full replace), `seo`,
`brand`, `categories` (full replace), `media` (attach, POST), `media/:assetId` (detach, DELETE),
`media` (reorder, PUT).

### `lib/api/products.ts`

Added 15 typed functions (`publishProduct`, `schedulePublishProduct`, `unpublishProduct`,
`archiveProduct`, `deleteProduct`, `addProductVariant`, `removeProductVariant`,
`updateProductVariant`, `setProductOptions`, `setProductSeo`, `setProductBrand`,
`assignProductCategories`, `attachProductMedia`, `detachProductMedia`, `reorderProductMedia`), all
calling `mutateAdminApi` with the exact method/path/body from the route table, and all using the
existing `isUnknown` validator — none of these routes' handlers map their response through a DTO
(several return the `Product` aggregate directly, same as `updateProduct` already did), so nothing
is read off the response; callers `revalidatePath` the detail page instead, which re-fetches real
state via the already-DTO-mapped `fetchProduct`.

### `app/products/actions.ts`

Added 15 `"use server"` actions (one per route above), each parsing `FormData` defensively, minting
one `newIdempotencyKey()`, calling the matching `lib/api/products.ts` function, and on `ok`
`revalidatePath("/products")` + `revalidatePath("/products/${productId}")` (then `redirect` for
`deleteProductAction`, since the page it deleted no longer exists) — otherwise `toFormState`. Added
four small parsing helpers reused across several actions: `optionalStringField` (blank → omitted
optional field, not a validation failure), `parseSelection` (a `"Color:Red, Size:M"` free-text
field → the variant `selection` map), `parseIdList` (comma-separated category ids), and
`parseOptions` (the options editor's repeated name/values rows, same array-field pattern as the
existing `parseVariants`).

### Components

- **`product-lifecycle-actions.tsx`** (new) — the lifecycle action bar, rendered above the status
  badge in `page.tsx`. Gated by `status` (draft/scheduled/published/archived, from
  `ProductStatusBadge`'s known list): draft → publish, schedule-publish, archive, delete; scheduled
  or published → unpublish, archive; archived → delete only. Archive/delete confirm via
  `window.confirm` first. A transition this best-effort gating still gets wrong (e.g. the backend
  rejecting an edge-case transition) surfaces as a normal form error, never silently swallowed.
- **`product-variants-card.tsx`** (rewritten, `"use client"`) — kept its existing read-only table
  display, added a per-row "Edit" toggle (inline sku/price/currency form,
  `updateProductVariantAction`) and "Remove" button (confirms, `removeProductVariantAction`), plus
  an "Add variant" form below the table (`addProductVariantAction`, with an optional
  `Color:Red, Size:M`-style selection field).
- **`product-organization-card.tsx`** (rewritten, `"use client"`) — brand field
  (`setProductBrandAction`), categories field (`assignProductCategoriesAction`, full replace), and
  an options editor (`setProductOptionsAction`, full replace, same add/remove-row pattern as
  `ProductCreateForm`'s variant rows) — draft-only on the backend, deliberately not pre-blocked
  client-side per the brief; a rejection on a published product surfaces via `toFormState`.
- **`product-media-seo-card.tsx`** (rewritten, `"use client"`) — attach form
  (`attachProductMediaAction`, plain `assetId` text input, no upload widget — out of scope per the
  brief), per-asset detach button (`detachProductMediaAction`, confirms), client-side up/down
  reordering with an explicit "Save order" submit (`reorderProductMediaAction`, sends the full
  `assetIds` order as repeated hidden inputs), and an SEO form (`setProductSeoAction`).
- **`page.tsx`** — wired `productId` through to all three cards, added
  `<ProductLifecycleActions productId status t />` above the status badge.

### `messages/en.ts` / `messages/ar.ts`

Added `productWriteCommon`, `productLifecycle`, `productVariantsForm`, `productOptionsForm`,
`productSeoForm`, `productBrandForm`, `productCategoriesForm`, `productMediaForm` — every new
string in both dictionaries, matching structure.

### `middleware.ts`

Checked, not modified. `/products/[productId]` (e.g. `/products/abc123`) does not match the
`/products/new` literal prefix, so it already falls under the `/products` → `viewer` entry (same as
the list screen and the pre-existing name/slug editor). Not lowered; each write action is still
independently permission-gated server-side (`products:update`/`products:publish`/etc. via
`AdminGuard`), so a viewer who somehow submits one gets a `forbidden` form error, never a silent
success.

### `docs/plans/PHASE-5-6-backlog.md`

Checked off `- [x] **T5.1 Product editor, complete.**`.

## Judgment call — recorded in `docs/plans/BLOCKERS.md`

Brand and category "pickers" are plain id text inputs, not a `<select>`/checklist, because:

1. **No `GET /brands` route exists at all** in `admin-routes.ts` — only create/rename/delete.
2. **`GET /categories` exists but returns the raw `Category` domain aggregate**, not a DTO — its
   handler is a one-line passthrough with no `toCategoryDto` mapping (unlike every product route).
   `Category`/`AggregateRoot`/`Entity` store `props`/`_id` as ordinary runtime-enumerable
   properties with no `toJSON`, so the real wire shape would leak internal structure — the same
   class of bug this repo's own `docs/plans/BLOCKERS.md` already found and fixed once for Analytics
   (T0.6) and documented again for Customer 360 (T3.3).

Building a typed `fetchCategories` against that undocumented, leaky shape would mean hard-coding
`Category`'s internal layout into `admin-web`, violating the repo-wide "domain aggregates never go
on the wire" rule. The brief's own explicit brand fallback ("no list route → note it and render a
plain text input") was applied to both fields instead — full details, including the exact
`AggregateRoot`/`Entity` fields inspected and the suggested T5.7 fix, are in
`docs/plans/BLOCKERS.md`'s new "T5.1" section. The write actions themselves
(`setProductBrandAction`/`assignProductCategoriesAction`) already send the correct primitive
`string | null` / `string[]` bodies, so upgrading to a real picker later needs no change to the
write side — only a DTO-mapped read.

## Files changed

- `apps/admin-web/src/lib/api/products.ts` — 15 new functions
- `apps/admin-web/src/lib/api/products.test.ts` — 17 new tests
- `apps/admin-web/src/app/products/actions.ts` — 15 new actions + 4 parsing helpers
- `apps/admin-web/src/app/products/[productId]/page.tsx` — wired `productId` + lifecycle bar
- `apps/admin-web/src/components/products/product-lifecycle-actions.tsx` — new
- `apps/admin-web/src/components/products/product-lifecycle-actions.test.tsx` — new
- `apps/admin-web/src/components/products/product-variants-card.tsx` — rewritten
- `apps/admin-web/src/components/products/product-variants-card.test.tsx` — new
- `apps/admin-web/src/components/products/product-organization-card.tsx` — rewritten
- `apps/admin-web/src/components/products/product-media-seo-card.tsx` — rewritten
- `apps/admin-web/src/messages/en.ts` — 8 new dictionary sections
- `apps/admin-web/src/messages/ar.ts` — matching 8 new dictionary sections
- `docs/plans/BLOCKERS.md` — new T5.1 entry
- `docs/plans/PHASE-5-6-backlog.md` — checked off T5.1

`middleware.ts` was read/verified, not modified (see above).

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck   # clean, no output
pnpm --filter admin-web lint        # 0 errors, 1 pre-existing warning (next.config.ts, unrelated)
pnpm --filter admin-web test        # 34 files, 304 tests passed (was 32 files / 279 tests before
                                     # this task; +25 new tests: 17 in products.test.ts, 4 in
                                     # product-lifecycle-actions.test.tsx, 4 in
                                     # product-variants-card.test.tsx)
```

Not verified in a live browser — no Docker in this environment to run `apps/runtime` + `admin-web`
together (same standing limitation `docs/plans/BLOCKERS.md`'s "Phase 3 screens not verified in a
live browser" note already records for this repo/session).

## Concerns for the next reviewer

- Brand/category fields are plain text inputs rather than a picker, per the judgment call above —
  functionally complete (correct primitive payload shapes, full-replace semantics for categories)
  but not the polished UX a real `<select>`/checklist would give; T5.7 is the natural place to
  upgrade this once the two backend gaps are fixed.
- Lifecycle status gating (draft/scheduled/published/archived → which buttons show) is a best-effort
  reading of `ProductStatusBadge`'s known statuses and the route table, not verified against the
  actual state-machine implementation in `services/catalog` — a hard backend rejection on an
  offered-but-actually-invalid transition surfaces as a normal form error, per the brief's own
  acceptance criterion, so this is not a correctness risk, only a possible UX rough edge (e.g. an
  operator seeing "Archive" enabled in a state the backend still rejects it from).
- Media reorder is "adjust locally with up/down, then explicitly Save order" rather than drag-and-
  drop — no drag-and-drop primitive exists in `@platform/ui` and adding one was out of scope.
