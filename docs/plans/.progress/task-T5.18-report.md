# Task T5.18 report — Product reviews (DISPLAY only)

## Status: DONE

**Scope note (read first):** this task ships DISPLAY only. Writing a review requires a
customer-identity decision that T5.16 owns and which has not landed. No review-submission form,
mutation route, or write use case was added anywhere in this change. A future task should
implement the write half only once T5.16's design is approved.

## What was investigated first

- Confirmed every route in `apps/admin/src/http/reviews-routes.ts` is admin-guarded
  (`reviews:read`/`reviews:create`/etc., delegating through `ReviewsAdminController`, which calls
  `guard.ensure(principal, ...)` before every action). None are `public: true`. The storefront
  cannot call any of them — a public route was genuinely missing, not just mis-permissioned.
- Read `ListReviewsByProduct` (`services/reviews/src/application/list-reviews-by-product.use-case.ts`):
  it delegates straight to `ReviewRepository.findByProductRef(productRef, page)` with **no status
  filter**. Confirmed, not assumed — same situation `ListPrices` is in for prices, which
  `publishedOnly()` in `public-catalog-routes.ts` already works around at the route level. This
  task's `publishedReviewsOnly()` follows that precedent, with one structural difference explained
  below.
- Checked `WiredAdmin.publicReads` (`apps/admin/src/composition.ts`): every existing public route
  (`public-catalog-routes.ts`, `public-cart-routes.ts`, `public-checkout-routes.ts`) calls the raw,
  **unguarded** framework-agnostic controller (e.g. `admin.publicReads.cart`, not
  `admin.cart`/`CartAdminController`) — `public-catalog-routes.ts`'s own header comment explains
  why: calling a guarded `*AdminController` with a fabricated anonymous `Principal` either silently
  allows everything (`AllowAllAccessControl`) or silently denies everything (Keto, no policy for a
  fabricated principal), depending on deployment. `reviews` was not yet exposed on `publicReads` —
  it had to be added (see below) rather than routing through the guarded `ReviewsAdminController`
  the brief's literal wording named, which would have reintroduced exactly the anti-pattern that
  comment warns against.

## Backend changes

- **`apps/admin/src/composition.ts`** — added `reviews: ReviewsController` to the `publicReads`
  interface and to the object `wireAdmin()` returns (`reviews: reviews.reviews`), mirroring how
  `cart`/`checkout` are already exposed there for the same reason (a guest/anonymous caller has no
  `Principal` to pass through the guarded facade). Added a doc comment explaining the choice.
- **`apps/admin/src/http/public-reviews-routes.ts`** (new file, matching the existing
  `public-cart-routes.ts`/`public-checkout-routes.ts` one-domain-per-file convention rather than
  growing `public-catalog-routes.ts`):
  - `PublicReviewDto`: exactly `id`, `rating`, `bodyText`, `assetRefs`, `verifiedPurchase`,
    `helpfulCount`, `unhelpfulCount`, `merchantResponse`. `customerRef`, `status`, `productRef`,
    `reportCount` are omitted, per the brief.
  - `toPublicReviewDto()` maps the real `Review` aggregate to that DTO — no aggregate internals on
    the wire (same discipline `public-catalog-routes.ts` documents).
  - `publishedReviewsOnly()` filters the raw `Paginated<Review>` page to `status.value ===
    "published"` **before** `mapPage()` converts it to `PublicReviewDto[]`. This is the one place
    this task's filter differs in shape from `publishedOnly()` in `public-catalog-routes.ts`:
    `publishedOnly` filters `PublicPriceDto[]` *after* mapping, because `PublicPriceDto` still
    carries `status`. `PublicReviewDto` deliberately does not (see rule 1 above), so filtering after
    mapping is impossible here — the raw aggregate's `status.value` is the only place left to check.
  - New route: `GET /public/reviews/by-product/:productRef`, cursor-paginated (`first`/`after`/
    `last`/`before`, same shape as every other public list route), `public: true`. Path chosen (over
    `/public/products/:slug/reviews`) because `Review.productRef` is an opaque string the Reviews
    context never resolves against Catalog's slug — using it directly avoids a slug→id resolution
    step, and it mirrors the existing admin route's own naming
    (`/reviews/by-product/:productRef`).
- **`apps/admin/src/http/admin-routes.ts`** — registered `publicReviewsRoutes(admin)` alongside the
  other `public*Routes` spreads.
- **`apps/admin/src/http/public-reviews-routes.test.ts`** (new) — drives the real `wireReviews()`
  in-memory composition through `RouteDefinition.handle()`, same technique
  `public-cart-routes.test.ts` uses. Three cases:
  1. A published review is returned as a `PublicReviewDto` with no `customerRef`/`status`/
     `productRef`/`reportCount` (and no aggregate internals — `props`/`_id`/`_domainEvents`/
     `_version`); a sibling pending review for the same product is excluded.
  2. Rejected, and flagged-then-removed reviews are excluded too — not just pending ones.
  3. A product's reviews never leak into another product's `productRef` query.

## Frontend changes (`apps/storefront`)

- **`src/lib/runtime-api.ts`** — added `ProductReviewSummary` and `getProductReviews(productRef,
  first, after)`, built on the existing `fetchPage` helper (reused, not duplicated — per the
  parent task's note that this file already has both `fetchList` and `fetchPage`). No client-side
  status filtering needed here, unlike `getPrices`/`getProducts`: the route already returns
  published-only, privacy-safe DTOs.
- **`src/components/product-reviews.tsx`** (new) — the review section itself: an explicit error
  state (`role="alert"`), an explicit empty state (`role="note"`, "no reviews yet"), an average
  rating + count summary computed from the reviews actually loaded on the current page (documented
  as such — there is no total-count field on a cursor-paginated route, so this does not claim to be
  a sitewide average, the same honesty limit `t.collection.productCount` already lives with), and a
  list of reviews each showing rating, body, a "Verified purchase" badge when applicable, helpful/
  unhelpful counts, and the merchant's response when present. A "next page" link carries the cursor
  in `?reviewsAfter=`, mirroring the collection page's `?after=` pattern from T5.20 exactly.
- **`src/app/products/[slug]/page.tsx`** — now accepts `searchParams` for `reviewsAfter`, fetches
  the reviews page in parallel with the price/availability books, and renders `<ProductReviews>`
  below the existing product card.
- **`src/messages/en.ts` / `src/messages/ar.ts`** — added every new string under `product.*`:
  `reviewsTitle`, `reviewsCount`, `reviewsEmpty`, `reviewsError`, `reviewsVerifiedPurchase`,
  `reviewsHelpful`, `reviewsUnhelpful`, `reviewsMerchantResponse`, `reviewsNextPage`.
- **`src/components/product-reviews.test.tsx`** (new) — 7 tests: explicit error state, explicit
  empty state, average/count computed correctly from a loaded page, verified-purchase badge shown
  only when true, merchant response shown only when present, next-page link present/absent and
  carrying the right cursor, and body text + helpful/unhelpful counts rendered.

## Verification (run synchronously, full output observed)

```
pnpm --filter @platform/admin typecheck   →  clean (tsc --noEmit, no output = success)
pnpm --filter @platform/admin test        →  41 files, 272 tests passed
pnpm --filter storefront typecheck        →  clean
pnpm --filter storefront lint             →  clean (eslint ., no output = success)
pnpm --filter storefront test             →  11 files, 105 tests passed (7 new, in product-reviews.test.tsx)
pnpm arch                                 →  "no dependency violations found (1635 modules, 7460 dependencies cruised)"
```

Ran twice (once mid-implementation, once as the final combined pass) — both green.

## Files changed

**Backend (`apps/admin`):**
- `apps/admin/src/composition.ts` — added `reviews: ReviewsController` to `publicReads`
- `apps/admin/src/http/public-reviews-routes.ts` — new
- `apps/admin/src/http/public-reviews-routes.test.ts` — new
- `apps/admin/src/http/admin-routes.ts` — registered `publicReviewsRoutes`

**Frontend (`apps/storefront`):**
- `apps/storefront/src/lib/runtime-api.ts` — added `ProductReviewSummary` + `getProductReviews`
- `apps/storefront/src/components/product-reviews.tsx` — new
- `apps/storefront/src/components/product-reviews.test.tsx` — new
- `apps/storefront/src/app/products/[slug]/page.tsx` — wired in the reviews section
- `apps/storefront/src/messages/en.ts` — new `product.reviews*` strings
- `apps/storefront/src/messages/ar.ts` — new `product.reviews*` strings

**Plan tracking:**
- `docs/plans/PHASE-5-6-backlog.md` — T5.18 checkbox marked `[x]`, with a note that only the
  display half shipped and the write half stays gated on T5.16.

## Concerns / follow-ups (none blocking)

- The review summary's average/count is scoped to the currently-loaded page (no total-count field
  exists on this cursor-paginated route). This is documented in `product-reviews.tsx`'s header
  comment and is the same limitation the T5.20 collection page already lives with for its own
  per-page product count — not a new gap this task introduced.
- Write-review (submission form, `POST` route reachable by an anonymous/identified shopper) is
  fully out of scope here and gated on T5.16's customer-identity decision, per the brief. Nothing
  in this change assumes or half-builds that path.
- `assetRefs` is carried through `PublicReviewDto` and the storefront's `ProductReviewSummary` type
  but not rendered — the brief's field list didn't ask for image rendering, and no other product
  detail element renders media either (the product DTO itself has no image field, per that page's
  existing header comment). Left as a typed-but-unused field rather than dropped, since the brief
  listed it explicitly as a field the DTO must carry.
