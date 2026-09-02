# Task T5.10 report — Review moderation queue

## Status: DONE

Built the Review moderation queue from scratch — no frontend existed for `apps/reviews`/Reviews
before this task. All 9 backend routes in `apps/admin/src/http/reviews-routes.ts` are wired.

## What was built

### Data layer
- `apps/admin-web/src/lib/review-lifecycle.ts` (new) — hand-copied UI-only transition table
  (`pending -> [published, rejected]`, `published -> [flagged, removed]`, `flagged -> [published,
  removed]`, `rejected`/`removed` terminal), plus `canRejectFrom`/`canFlagFrom`/`canRestoreFrom`/
  `canRemoveFrom` (gate the 4 `moderate` actions) and `advanceableReviewStatusesFrom` (the generic
  advance-dropdown residual — computed via a `DEDICATED_COVERED_TARGETS` map, same technique
  `lib/fulfillment-lifecycle.ts` established for T5.4). Verified by hand which of `moderate`'s 4
  actions (`reject`/`flag`/`restore`/`remove`) cover which transition-table edges: `reject`
  (pending->rejected), `flag` (published->flagged), `restore` (flagged->published), `remove`
  (published/flagged->removed). The one edge none of the 4 actions cover is `pending -> published`
  (there is no dedicated "approve" moderate action) — that's the sole target the generic advance
  dropdown ever offers, only at `pending`.
- `apps/admin-web/src/lib/review-lifecycle.test.ts` (new) — 14 tests covering every gate function
  and the advance residual, including the terminal/unrecognized-status edge cases.
- `apps/admin-web/src/lib/api/reviews.ts` (new) — `fetchReviewsPage` (the queue, with `status`
  filter), `fetchReviewsByProduct`, `fetchReview`, and 6 mutate functions: `createReview`,
  `advanceReview`, `voteReview`, `reportReview` (no idempotency key — the route is **not**
  idempotent per the brief's route table), `respondToReview`, `moderateReview` (sends the same
  `newIdempotencyKey()` value as both the `Idempotency-Key` header and the body's `actionId`,
  per the brief's double-field note — I could not find an existing "coupon-redeem" precedent in
  the repo to copy verbatim, since `apps/discounts`/coupons redeem has not actually been built in
  admin-web yet (only a read-only coupon list exists) — so I applied the pattern described in the
  brief text directly).
- `apps/admin-web/src/lib/api/reviews.test.ts` (new) — 13 tests, one per fetch/mutate function,
  mirroring `lib/api/brands.test.ts`'s fetch-mocking style, including an explicit assertion that
  `reportReview` sends no `idempotency-key` header.

### Screens
- `apps/admin-web/src/app/reviews/page.tsx` (new) — **the moderation queue**, the primary
  deliverable. Server component, Suspense-streamed results (chrome never blocks on `GET /reviews`),
  status filter in the URL (`?status=&after=`) defaulting to `pending` when the URL carries no
  filter at all. An explicit `status=all` (via the toolbar's "All statuses" option) is a durable
  URL state distinct from "no filter present," so choosing it survives a refresh/back — it does not
  collapse back to the `pending` default. Table columns: rating, review excerpt, verified purchase,
  report count, status badge; each row links to the detail page.
- `apps/admin-web/src/app/reviews/[reviewId]/page.tsx` (new) — full detail: every `ReviewDto`
  field, gated moderation controls, merchant-response form (pre-filled with the existing
  `merchantResponse` if set), and vote/report forms.
- `apps/admin-web/src/app/reviews/new/page.tsx` (new) — create form (productRef/customerRef/
  rating/bodyText/optional comma-separated assetRefs). `verifiedPurchase` is not a form field —
  the backend decides it via `OrdersPort`.
- `apps/admin-web/src/app/reviews/actions.ts` (new) — 6 server actions, one per mutate route, same
  defensive-FormData-parsing shape every prior Phase 5 write action follows.

### Components (`apps/admin-web/src/components/reviews/`)
- `review-status-badge.tsx`, `reviews-toolbar.tsx` (status filter, querystring-driven, no search
  box since the route has none), `reviews-table.tsx`, `reviews-pagination.tsx` (forward-cursor
  back-stack, same technique as `OrdersPagination` — every `pageInfo` in this app is
  `{ hasNextPage, endCursor }` only, so `last`/`before` in the backend's querystring have no
  corresponding UI capability, matching every other Phase 5 list screen's precedent).
- `review-lifecycle-actions.tsx` — one shared moderatorRef/reason form with one submit button per
  action the transition table allows at the current status (multiple-submit-buttons-one-form
  technique, same as `ReturnLifecycleActions`' `DecisionForm`), plus the generic advance dropdown
  fallback rendered only when `advanceableReviewStatusesFrom` is non-empty. Renders nothing at a
  terminal status.
- `review-customer-actions.tsx` (vote + report forms — normally customer/storefront actions, kept
  visually separate from the moderator controls, offered per the brief's explicit instruction to
  include them for completeness/testing).
- `review-respond-form.tsx`, `review-create-form.tsx`.

### Navigation, gating, i18n
- `components/navigation.ts` — new `reviews` nav entry (between Customers and Analytics),
  `StarIcon`.
- `middleware.ts` — `["/reviews/new", "operator"]`, `["/reviews", "viewer"]` (queue is
  read-heavy/viewer-browsable; moderation actions on the detail page are independently
  permission-gated server-side — a viewer can view, the backend rejects the actual submit, same
  precedent as every prior Phase 5 detail-page write action).
- `messages/en.ts` / `messages/ar.ts` — every new string in both: `nav.reviews`, `reviewsPage`,
  `reviewStatus`, `reviewCreateForm`, `reviewDetail`, `reviewLifecycle`, `reviewVoteForm`,
  `reviewReportForm`, `reviewRespondForm`.

### Plan bookkeeping
- `docs/plans/PHASE-5-6-backlog.md` — T5.10's checkbox ticked (`- [x] **T5.10 Review moderation
  queue.**`).
- Nothing was blocked — no `docs/plans/BLOCKERS.md` entry was needed. (I deliberately left
  `docs/plans/.progress/phase5-ledger.md` untouched — per T5.7's own ledger entry, that file is
  controller-owned, not an implementer's to edit.)

## Verification

```
pnpm --filter admin-web typecheck   -> clean, no errors
pnpm --filter admin-web lint        -> clean, 0 errors, 1 pre-existing unrelated warning
                                        (next.config.ts's `headers` async-without-await — present
                                        before this task, not introduced by it)
pnpm --filter admin-web test        -> 54/54 test files, 491/491 tests passing
                                        (27 new tests added: 14 in review-lifecycle.test.ts,
                                        13 in lib/api/reviews.test.ts)
```

## Concerns / notes for the controller

- No component-level tests were added for the new page/form components (`review-lifecycle-
  actions.tsx`, `review-create-form.tsx`, etc.) — consistent with T5.9's Content/Pages/SEO/Theme
  precedent (those detail/create screens also ship without component tests; only the data-layer
  `lib/*-lifecycle.ts` and `lib/api/*.ts` files get dedicated test files across this phase). Data
  logic (the part most likely to have a subtle bug) is fully covered.
- The brief's `moderate`/`actionId` note pointed at "T5.8's coupon-redeem" as the precedent for the
  double-idempotency-field pattern; that precedent does not actually exist yet in the repo (T5.8 is
  still unchecked in the backlog — `discounts/page.tsx` is read-only today). I implemented the
  pattern directly from the brief's own description (same value as both the `Idempotency-Key`
  header and the body's `actionId`) rather than copying nonexistent code — flagging this in case
  the controller wants to double check against T5.8 once it lands.
- `reviewsPage`'s empty-state message uses `emptyFiltered` ("No reviews match this filter") for the
  default `pending` view too (any specific status counts as "filtered", only `status=all` gets the
  plain `empty` message) — a genuinely empty pending queue is arguably worth a more celebratory
  message ("queue is clear"), but I judged the existing wording accurate enough not to invent a new
  dictionary key pair for a minor tone difference.
