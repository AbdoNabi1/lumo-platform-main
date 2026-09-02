# Task T5.8 report — Coupons and promotions write

## Summary

Two independent sub-tasks, both delivered:

**A. Coupons write** (`apps/discounts`) — added the 3 coupon write routes to the existing
read-only Discounts screen: create (`/discounts/new`), advance status (inline per-row control on
the list, since no coupon detail page exists), and redeem (a second panel on `/discounts/new`,
since it's a customer-facing/POS-style action rather than a typical admin write).

**B. Promotions, built from scratch** (`apps/promotions`) — no frontend existed for this domain.
Added list (`/promotions`), create (`/promotions/new`), detail (`/promotions/[promotionId]`) with
the full field set, the "advance to…"/"record usage" lifecycle controls, and an "Evaluate"
simulation panel. The backend read side (`GET /promotions`, `GET /promotions/:promotionId`) was
already fully DTO-mapped from Phase 4 T4.5 — no backend gap, built directly against `PromotionDto`.

## Files changed

### New files

- `apps/admin-web/src/lib/coupon-lifecycle.ts` — UI-only copy of the coupon status transition
  table (`active: [disabled, expired, depleted]`, `disabled: [active, expired]`,
  `expired: []`, `depleted: []`), hand-kept per the repo-wide "never import `services/*`" rule.
- `apps/admin-web/src/lib/coupon-lifecycle.test.ts` — matches the table's own keys, every
  transition, terminal statuses, and an unrecognized status.
- `apps/admin-web/src/app/discounts/actions.ts` — `createCouponAction`, `advanceCouponAction`,
  `redeemCouponAction`. Same shape as `app/products/actions.ts`'s reference actions: parse
  `FormData` defensively, mint one `Idempotency-Key` per invocation, `revalidatePath("/discounts")`
  on `ok`, otherwise `toFormState`.
- `apps/admin-web/src/app/discounts/new/page.tsx` — the coupon create form + the redeem panel,
  both on one screen (operator's call per the brief, since redeem is one of the 4 coupon routes
  but not a typical admin write screen).
- `apps/admin-web/src/components/discounts/coupon-create-form.tsx`
- `apps/admin-web/src/components/discounts/coupon-redeem-form.tsx`
- `apps/admin-web/src/components/discounts/discounts-table.tsx` — extracted from the inline table
  `app/discounts/page.tsx` used to render server-side, now a Client Component so each row can carry
  its own "advance status" control (same "no detail page, per-row inline action" shape
  `ContentBlocksTable` established in T5.9a). Also links each coupon's `promotionRef` to
  `/promotions/:promotionId` (the brief's nice-to-have).
- `apps/admin-web/src/lib/api/promotions.ts` — `PromotionDto`, `fetchPromotionsPage`,
  `fetchPromotion` (following `lib/api/products.ts`'s `fetchProductsPage`/`fetchProduct` pattern
  exactly), `createPromotion`, `advancePromotion`, `evaluatePromotions`, `recordPromotionUsage`.
- `apps/admin-web/src/lib/promotion-lifecycle.ts` — UI-only copy of the promotion status
  transition table (8 statuses, verbatim from the brief).
- `apps/admin-web/src/lib/promotion-lifecycle.test.ts` — every transition, all 3 terminal-ish
  paths to `archived`, the fully-terminal `archived` status, and an unrecognized status.
- `apps/admin-web/src/app/promotions/actions.ts` — `createPromotionAction`,
  `advancePromotionAction` (idempotent, same shape as every other Phase 5 write action);
  `recordPromotionUsageAction`, `evaluatePromotionsAction` (deliberately mint **no**
  `Idempotency-Key` — see below).
- `apps/admin-web/src/app/promotions/page.tsx` — list screen (`ProductsPage`/`PagesPage` pattern).
- `apps/admin-web/src/app/promotions/new/page.tsx` — create form.
- `apps/admin-web/src/app/promotions/[promotionId]/page.tsx` — detail screen: full field display
  (all 20 `PromotionDto` fields), the lifecycle actions card, and the Evaluate panel.
- `apps/admin-web/src/components/promotions/promotion-status-badge.tsx`
- `apps/admin-web/src/components/promotions/promotion-create-form.tsx` — the big, conditional
  `createPromotionBody` shape rendered plainly per the brief: every field always shown, no
  dynamic show/hide beyond basic usability.
- `apps/admin-web/src/components/promotions/promotion-lifecycle-actions.tsx` — "advance to…" +
  "record usage".
- `apps/admin-web/src/components/promotions/promotion-evaluate-panel.tsx` — the cart-snapshot
  "try it out" simulation panel; renders the raw `PromotionDetermination[]` result, never
  `revalidatePath`s anything (nothing changed — see below).
- `apps/admin-web/src/components/promotions/promotions-pagination.tsx`

### Modified files

- `apps/admin-web/src/lib/api/discounts.ts` — added `createCoupon`, `advanceCoupon`,
  `redeemCoupon` (the 3 coupon write routes) alongside the existing `fetchCouponsPage`.
- `apps/admin-web/src/app/discounts/page.tsx` — added a "New coupon" header button, replaced the
  inline table with `<DiscountsTable>`, updated the stale doc comment ("Promotions has no list
  capability of its own yet" → now describes the T5.8 Part B screen and the `promotionRef` link).
- `apps/admin-web/src/components/navigation.ts` — added the `promotions` nav entry (`GiftIcon`,
  right after `discounts`).
- `apps/admin-web/src/middleware.ts` — added `["/promotions/new", "operator"]`,
  `["/promotions", "viewer"]` to `ROUTE_ROLE_REQUIREMENTS`.
- `apps/admin-web/src/messages/en.ts` / `apps/admin-web/src/messages/ar.ts` — every new string:
  `nav.promotions`, `discountsPage.newCoupon`, `discountsRowActions`, `couponCreate`,
  `couponRedeem`, `promotionsPage`, `promotionStatus`, `promotionRuleType`, `promotionScope`,
  `promotionRewardType`, `promotionCreate`, `promotionDetail`, `promotionLifecycle`,
  `promotionEvaluate`. `ar.ts` is typed as `Dictionary` (`Widen<typeof en>`), so a missing Arabic
  key is a compile error, not a silent English fallback — typecheck confirms both dictionaries
  stay in lockstep.
- `docs/plans/PHASE-5-6-backlog.md` — ticked T5.8's checkbox.

## Key decisions

1. **Coupon redeem's double idempotency key.** Per the brief's explicit instruction:
   `redeemCouponAction` mints exactly one `newIdempotencyKey()` and passes it into
   `redeemCoupon(input, idempotencyKey)`, which threads that single value into both the request
   body's own `idempotencyKey` field AND the `Idempotency-Key` HTTP header `mutateAdminApi` sends —
   never two different values.

2. **`evaluate`/`record-usage` deliberately send no `Idempotency-Key`.** Both routes lack
   `idempotent: true` in `apps/admin/src/http/promotions-routes.ts` (unlike `create`/`advance`,
   which are idempotent). `evaluatePromotions` is a pure read/simulation — no mutation to dedupe.
   `recordPromotionUsage` is meant to record one more usage per call; a repeat-key dedupe would
   silently drop a real usage, which is the wrong behavior for this route. Both `lib/api/
   promotions.ts` functions and their corresponding actions document this explicitly and omit the
   key on purpose.

3. **No coupon detail page** (per the brief: "this list has no detail page today; adding one is
   not required, a per-row action is enough"). `DiscountsTable`'s per-row "advance status" control
   follows the exact pattern T5.9a's `ContentBlocksTable` established for the same situation
   (Content Blocks also has no detail page).

4. **Promotions detail page does exist** (unlike coupons) since `GET /promotions/:promotionId`
   was already built and DTO-mapped — full field display, lifecycle actions, and the Evaluate
   panel all live there, following `ProductDetailPage`/`PageDetailPage`'s established shape.

5. **`targetRefs`/`customerRefs`/`segmentRefs`/`promotionRef` are plain text** (comma-separated
   for the arrays) — no product/category/customer/segment/promotion picker exists in this
   codebase's scope, same "plain text ref, no picker" discipline `PageCreateForm` already uses for
   `templateRef`/`experienceRef`.

6. **Evaluate panel's cart lines** are a small fixed set of 3 rows (no dynamic add-row) — a blank
   `lineProductRef` row is treated as unused, not a validation error, since this is a "try it out"
   tool, not a real cart. Documented in both the component and `evaluatePromotionsAction`.

7. Followed the exact global constraints: both transition tables are hand-kept UI-only copies
   (never imports from `services/*`), no domain aggregates cross the wire (only the pre-existing
   `PromotionDto`/`CouponListItemDto`, both hand-typed), no fabricated data, every string is in
   both dictionaries, no `git` commands were run.

## Verify

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck   # clean, 0 errors
pnpm --filter admin-web lint        # clean, 0 errors (1 pre-existing unrelated warning in next.config.ts)
pnpm --filter admin-web test        # 56/56 test files, 507/507 tests passed
```

The test suite grew from 54 files / 491 tests to 56 files / 507 tests: added
`coupon-lifecycle.test.ts` (6 tests) and `promotion-lifecycle.test.ts` (10 tests), following the
established convention that every hand-kept lifecycle transition table (`order-lifecycle.test.ts`,
`content-lifecycle.test.ts`, `pages-lifecycle.test.ts`, `review-lifecycle.test.ts`, etc.) gets a
matching pure-function test file. No `lib/api/discounts.test.ts`/`lib/api/promotions.test.ts` was
added — that layer's test coverage is selective in this codebase (several fully-built T5.9 domains
like `content`/`pages`/`seo`/`theme` also have no `lib/api/*.test.ts`), so this follows precedent
rather than gapping it.

## Concerns / follow-ups

- No backend gap was found for either sub-task; the brief's route tables were followed verbatim
  and matched the actual route definitions in `apps/admin/src/http/coupons-routes.ts` and
  `promotions-routes.ts` on inspection.
- Nothing was blocked; `docs/plans/BLOCKERS.md` was not touched.
