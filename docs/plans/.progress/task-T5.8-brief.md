# Task T5.8 brief — Coupons and promotions write

Same write-screen recipe as prior Phase 5 tasks. Two sub-tasks: (A) add coupon create/advance to
the existing read-only Discounts screen, (B) build a new Promotions screen from scratch (list,
create, advance, record-usage) — its backend read side (`GET /promotions`, `GET /promotions/:id`)
was already built in Phase 4 T4.5 and is fully DTO-mapped, no backend gap here.

## A. Coupons — `apps/admin/src/http/coupons-routes.ts` (read in full, verbatim below)

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/coupons` (create) | POST | `coupons:create` | yes | `{ code: string.min(1), promotionRef: string.min(1), multiUse: boolean, usageLimit?: int().positive(), customerRef?: string.min(1), expiresAt?: z.coerce.date(), campaignRef?: string.min(1) }` |
| `/coupons/:couponId/transitions` (advance) | POST | `coupons:advance` | yes | `{ toStatus: "active"\|"disabled"\|"expired"\|"depleted" }` |
| `/coupons/redeem` | POST | `coupons:redeem` | yes | `{ code: string.min(1), customerRef: string.min(1), idempotencyKey: string.min(1), orderRef?: string.min(1) }` — **note this body carries its own `idempotencyKey` field, separate from the `Idempotency-Key` HTTP header** `mutateAdminApi` sends; mint one value with `newIdempotencyKey()` and pass it to BOTH (as the header, via `mutateAdminApi`'s normal mechanism, AND as this field) — do not mint two different values. |

`GET /coupons` (list) is already wired (`fetchCouponsPage` in `lib/api/discounts.ts`, used by
`apps/discounts/page.tsx`) — do not touch its read path.

Coupon status transition table (copy verbatim as UI-only data, comment sourced from
`services/coupons/src/domain/value-objects/coupon-status.ts`, never import `services/*`):
```
active: [disabled, expired, depleted]
disabled: [active, expired]
expired: []
depleted: []
```
`expired`/`depleted` are terminal — render no advance control at all there, not a disabled one.

**What to build:** a "Create coupon" form (new page or modal — a new `apps/admin-web/src/app/
discounts/new/page.tsx` following `apps/products/new`'s pattern is simplest) linked from the
Discounts list page's header. Add an inline "advance status" control per row (or per a small
detail affordance — this list has no detail page today; adding one is not required, a per-row
action is enough) gated by the transition table. Redeem is a customer-facing/POS-style action, not
really an "admin write screen" in the usual sense — add it as its own small form on the same
`/discounts/new` page or a `/discounts/redeem` page, operator's call, but include it (it's one of
the 4 coupon routes and the task says "9 write routes" collectively for T5.8).

## B. Promotions — `apps/admin/src/http/promotions-routes.ts` (read in full, verbatim below)

`GET /promotions` and `GET /promotions/:promotionId` already return the full, DTO-mapped
`PromotionDto` (id, name, status, ruleType, scope, targetRefs, minimumQuantity,
minimumSubtotalAmountMinor, rewardType, rewardValue, buyQuantity, getQuantity, stackable, priority,
startsAt, endsAt, customerRefs, segmentRefs, campaignRef, usageLimit, usageCount) — Phase 4 T4.5's
work, no gap here, build against it directly.

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/promotions` (create) | POST | `promotions:create` | yes | see full shape below |
| `/promotions/:promotionId/transitions` (advance) | POST | `promotions:advance` | yes | `{ toStatus: "draft"\|"scheduled"\|"active"\|"paused"\|"expired"\|"depleted"\|"cancelled"\|"archived" }` |
| `/promotions/evaluate` | POST | `promotions:evaluate` | **no** | cart-snapshot body (pure read/simulation — see below) |
| `/promotions/:promotionId/record-usage` | POST | `promotions:record_usage` | **no** | none (params only) |
| `/promotions` (list) | GET | `promotions:read` | — | already usable |
| `/promotions/:promotionId` (get) | GET | `promotions:read` | — | already usable |

`createPromotionBody`: `{ name: string.min(1), ruleType: "automatic"|"buy_x_get_y", scope:
"cart"|"product"|"category", targetRefs: string[], minimumQuantity?: int().positive(),
minimumSubtotalAmountMinor?: int().min(0), rewardType: "percentage"|"fixed_amount"|
"free_shipping", rewardValue?: number, buyQuantity?: int().positive(), getQuantity?:
int().positive(), stackable: boolean, priority: int(), startsAt: z.coerce.date(), endsAt?:
z.coerce.date(), customerRefs?: string[], segmentRefs?: string[], campaignRef?: string.min(1),
usageLimit?: int().positive() }`. This is a big, conditional form — `rewardType`/`ruleType`
determine which of the optional fields are meaningful (e.g. `buyQuantity`/`getQuantity` only make
sense for `ruleType: "buy_x_get_y"`); render all fields plainly, do not over-engineer conditional
show/hide logic beyond basic usability, the backend validates the real business rules.

`evaluatePromotionsBody`: a cart snapshot (`{ cart: { lines: [{productRef, categoryRefs,
quantity, unitPriceAmountMinor}], subtotalAmountMinor }, customerRef, segmentRefs? }`) — this is a
"try it out" simulation tool, not a mutation (`summary: "pure read"`, despite being a `POST`). Add
it as a small "Evaluate" panel on the promotion detail view, not a full mutate-and-redirect Server
Action — it's fine to call `mutateAdminApi` for this (it's still a POST through the same client)
but treat the result as a read/preview, not something that `revalidatePath`s anything.

Promotion status transition table (copy verbatim, sourced from
`services/promotions/src/domain/value-objects/promotion-status.ts`):
```
draft: [scheduled, active, cancelled, archived]
scheduled: [active, cancelled, archived]
active: [paused, expired, depleted, cancelled, archived]
paused: [active, expired, cancelled, archived]
expired: [archived]
depleted: [archived]
cancelled: [archived]
archived: []
```

## What to build (Promotions)

1. `apps/admin-web/src/lib/api/promotions.ts` (new) — `fetchPromotionsPage`, `fetchPromotion`
   (both following `lib/api/products.ts`'s `fetchProductsPage`/`fetchProduct` pattern exactly,
   since the DTO here is just as flat), `createPromotion`, `advancePromotion`, `evaluatePromotions`,
   `recordPromotionUsage`.
2. `apps/admin-web/src/app/promotions/page.tsx` (new, list, `products/page.tsx`'s pattern) +
   `apps/admin-web/src/app/promotions/new/page.tsx` (create form) +
   `apps/admin-web/src/app/promotions/[promotionId]/page.tsx` (detail: full field display, advance
   control gated by the table above, record-usage button, the evaluate panel) + `actions.ts` in
   each relevant segment.
3. Navigation + `middleware.ts`: add a `promotions` nav entry, `["/promotions", "viewer"]` (list
   readable), `["/promotions/new", "operator"]` (create/advance/etc. are writes).
4. Update `apps/discounts/page.tsx`'s doc comment: it currently says "Promotions has no list
   capability of its own yet" — that's now stale (Phase 4 T4.5 built it, this task builds its UI).
   Update the comment to reflect reality, and consider linking a coupon's `promotionRef` to
   `/promotions/:promotionId` in the coupons table (nice-to-have, not required).
5. Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (apply to every Phase 5 admin task)

1. `packages/*`/`services/*` never import from `apps/*`; copy both transition tables as data.
2. Domain aggregates never go on the wire — `PromotionDto`/`CouponListItemDto` are already
   correctly hand-typed; keep any new types the same way.
3. Never fabricate data in the UI.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark this task's checkbox (`- [ ] **T5.8 Coupons and promotions write.**` → `- [x] ...`) when
   done.
8. One `Idempotency-Key` per user-initiated submit (see the coupon-redeem double-field note above
   for the one exception where a value is also needed in the body).
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.8-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
