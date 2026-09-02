# Task T5.18 brief — Product reviews: DISPLAY half only

**This brief covers display only.** Writing a review requires the customer-identity decision
T5.16 owns — do not build a review-submission form in this task. If T5.16's design has already
landed by the time you start, that still doesn't authorize building the write half here; that is
a separate task (dispatched later, once T5.16's design is approved and something can implement
against it). Confirm your own scope stays display-only before finishing.

## Backend: a small, contained addition (same class as T5.15/T5.20's public-route additions)

Confirmed (verify, don't re-derive): every route in `apps/admin/src/http/reviews-routes.ts` is
admin-guarded (`reviews:read`/`reviews:create`/etc., none marked `public: true`) — including the
reads. The storefront cannot call any of them. Add one new public route:

1. **`apps/admin/src/http/public-catalog-routes.ts`** (or a new small `public-reviews-routes.ts`
   file if you judge it cleaner — check whether other public surfaces beyond catalog already live
   in their own files, e.g. `public-cart-routes.ts`/`public-checkout-routes.ts` do; if so, match
   that convention with a new `public-reviews-routes.ts` rather than growing
   `public-catalog-routes.ts` further) — add `GET /public/products/:slug/reviews` (or
   `/public/reviews/by-product/:productRef` if that reads more naturally alongside the existing
   admin route's own naming — your call, keep it cursor-paginated and consistent with this file's
   other public list routes).
2. **A public-safe DTO.** Do NOT reuse `ReviewDto` verbatim — it carries `customerRef` (a specific
   customer's identifier — must never appear on an anonymous, public surface) and `reportCount`
   (an internal moderation signal, not something to show shoppers gauging trustworthiness). Define
   a `PublicReviewDto` with exactly: `id`, `rating`, `bodyText`, `assetRefs`, `verifiedPurchase`,
   `helpfulCount`, `unhelpfulCount`, `merchantResponse`. Omit `customerRef`, `status`, `productRef`
   (redundant — the caller already knows which product), `reportCount`.
3. **Filter to `status: "published"` only**, same boundary-filtering pattern
   `publishedOnly()` already establishes in `public-catalog-routes.ts` for prices — read that
   function, copy its shape for reviews (filter after the existing `admin.reviews.listByProduct`
   call, same as `publishedOnly` filters after `ListPrices`, since the underlying use case doesn't
   itself filter by status — verify this assumption by reading `ListReviewsByProduct`'s use case
   first, don't assume).
4. Handler calls `admin.reviews.listByProduct(...)` (the existing controller method, already
   built) — you are adding a new **route** with a stricter DTO and status filter, not a new
   backend capability; the read capability itself already exists, just behind the wrong guard.
5. Run `pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test` before the
   frontend. Add a route test confirming: no `customerRef`/`reportCount` in the response shape,
   and a non-published review is excluded. Run `pnpm arch` (you may have touched `services/*` only
   if you added a new filtering step there — check whether the use case itself needs a status
   filter option or whether route-level filtering, like `publishedOnly`, is sufficient; prefer the
   latter, it's less invasive and matches existing precedent).

## Frontend: `apps/storefront`

1. `apps/storefront/src/lib/runtime-api.ts` (or `lib/catalog.ts`, match whichever file already
   holds product-detail-adjacent fetches) — add a `getProductReviews(productSlugOrRef, first,
   after)` function.
2. Render reviews on the product detail page (`apps/storefront/src/app/products/[slug]/page.tsx`
   — check its current structure first): a summary (average rating, count) plus a paginated list,
   each showing rating/body/verified-purchase badge/helpful counts/merchant response if present.
   Explicit empty state ("no reviews yet") and explicit error state — never a silently missing
   section.
3. Every new string in both storefront dictionaries.

## Global constraints (Phase 5 storefront/backend tasks)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire — the new `PublicReviewDto` is exactly the field list
   above, nothing more.
3. Never fabricate data, and never leak `customerRef`/unpublished reviews onto the public surface
   — this task's core privacy/correctness rule.
4. Every user-facing string in both storefront dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark T5.18's checkbox (`- [ ] **T5.18 Product reviews.**` → `- [x] **T5.18 Product reviews.**`)
   when the display half is done — note clearly in your report that only display shipped and
   writing is intentionally deferred to T5.16's decision, so a future session doesn't assume the
   whole task (including write) is finished.
8. N/A (read-only).
9. The storefront calls the runtime API only from Server Components/Server Actions.

## Verify

```bash
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm --filter storefront typecheck && pnpm --filter storefront lint && pnpm --filter storefront test
pnpm arch
```

## Report

Write your full report to `docs/plans/.progress/task-T5.18-report.md`. Return to the controller
only: status, files changed (backend and frontend separately), one-line test summary per package,
concerns — and an explicit note that write-review is deferred to T5.16.
