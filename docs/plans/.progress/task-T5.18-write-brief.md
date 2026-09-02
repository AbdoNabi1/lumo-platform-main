# Task T5.18-write brief — Product review authoring (the deferred write half)

T5.18's display half already shipped (public review reads, `PublicReviewDto`, the storefront
product-detail review section). This task adds the write half that was explicitly deferred until
the customer-identity decision existed. It now does — T5.17 built the real foundation. Read
`docs/plans/BLOCKERS.md`'s `## T5.17` entry in full first (search for that heading), and read
`apps/admin/src/http/public-wishlist-routes.ts` in full — it is your template for the
session-scoping pattern. Also read the existing `apps/admin/src/http/public-reviews-routes.ts`
(from T5.18's display half) — you are extending that file, not replacing it.

## Scope

`apps/admin/src/http/reviews-routes.ts` has a `POST /reviews` create route (`reviews:create`,
`{ productRef, customerRef, rating, bodyText, assetRefs? }`) that is currently only reachable
admin-side. This task exposes **review creation** to a signed-in customer, session-scoped —
`customerRef` must come from `admin.customerAuth.requireSession(...)`, never from the request
body, even though the admin-facing route's own zod schema has a `customerRef` field (that field
exists for the admin/operator use case, where staff legitimately create a review record on a
customer's behalf; the public route must not expose that same freedom).

`voteReview`/`reportReview` (also currently admin-only) are good candidates to expose too, same
session-scoping discipline, since a customer voting/reporting on a review is a natural extension —
your call whether to include them in this dispatch or leave them for a follow-up; if you include
them, they follow the exact same pattern as create.

**Do not** expose `advance`/`respond`/`moderate` here — those stay admin/moderator-only
(T5.10's territory), not something a customer self-serves.

## What to build

### Backend

1. **`apps/admin/src/http/public-reviews-routes.ts`** (existing, extend) — add
   `POST /public/reviews` (create), `public: true`, requiring a customer session via
   `admin.customerAuth.requireSession(resolveCustomerSessionId(context))` (same import from
   `public-auth-routes.ts` the wishlist file uses). The route's own zod body must NOT include
   `customerRef` — only `productRef`, `rating`, `bodyText`, `assetRefs?`. The handler injects
   `customerRef: guarded.session.customerRef` when calling `admin.publicReads.reviews.create(...)`.
   `verifiedPurchase` is decided server-side by the existing `OrdersPort` the create use case
   already calls — nothing new needed there.
2. If including vote/report: same pattern, `POST /public/reviews/:reviewId/vote` and
   `POST /public/reviews/:reviewId/report`, session-derived `customerRef`/`reporterRef`, no
   client-supplied identity field.
3. Route tests: session-required (401 without one), the created review's `customerRef` is
   verifiably the session's own even if a malicious body tries to include a different one (the
   zod schema should make this impossible by construction — a body that includes `customerRef`
   should either be rejected by `.strict()` or silently ignored because the handler never reads it
   off `body`; prefer `.strict()` so a client sending it gets an explicit error, not silent
   ignoring — verify which behavior your schema actually produces and pick deliberately, don't
   leave it to chance).

### Frontend (`apps/storefront`)

1. `apps/storefront/src/lib/runtime-api.ts` — a `createProductReview(input)` function, session-aware
   (send the customer session the same way wishlist mutations do).
2. A review-submission form on the product detail page, rendered **only** when a real server-side
   session check succeeds (same discipline `AddToWishlistButton` uses — no form, not a
   disabled/misleading one, for a signed-out shopper). Link to sign-in for a signed-out shopper
   instead.
3. Every new string in both storefront dictionaries.

## Global constraints (Phase 5 storefront tasks)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate data or accept a client-supplied `customerRef`/`reporterRef` on any new route —
   this task's core rule, mirroring T5.17's wishlist discipline exactly.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark T5.18's checkbox note updated (it's already `[x]` from the display half — add a note to
   the checkbox line or a nearby comment in `PHASE-5-6-backlog.md` if useful, but the checkbox
   itself is already correctly ticked; the important record is this task's own report and any
   BLOCKERS.md update, not re-ticking an already-ticked box).
8. One `Idempotency-Key` per user-initiated submit on every new write route.
9. The storefront calls the runtime API only from Server Components/Server Actions.

## Verify

```bash
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm --filter storefront typecheck && pnpm --filter storefront lint && pnpm --filter storefront test
pnpm arch
```

## Report

Write your full report to `docs/plans/.progress/task-T5.18-write-report.md`. Return to the
controller only: status, files changed (backend and frontend separately), one-line test summary
per package, concerns.
