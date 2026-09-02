# Task T5.10 brief — Review moderation queue

Same write-screen recipe as every prior Phase 5 task. **No frontend exists for reviews at all** —
build the whole thing from scratch. `apps/admin/src/http/reviews-routes.ts` (read in full, verbatim
below) already has fully DTO-mapped list (with a moderation-queue `status` filter), list-by-product,
and get.

## DTO (already correct on the backend)

`ReviewDto`: `{ id, productRef, customerRef, rating: number, bodyText, assetRefs: string[],
verifiedPurchase: boolean, status, helpfulCount: number, unhelpfulCount: number, reportCount:
number, merchantResponse: string | null }`.

## Routes

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/reviews` (create) | POST | `reviews:create` | yes | `{ productRef, customerRef, rating: number, bodyText: string.min(1), assetRefs?: string[] }` — normally customer-initiated (T5.18, storefront), but this admin console can also create one directly (e.g. for support/testing) — include the form, don't skip it |
| `/reviews/:reviewId/transitions` (advance) | POST | `reviews:advance` | yes | `{ toStatus: "pending"\|"published"\|"rejected"\|"flagged"\|"removed" }` |
| `/reviews/:reviewId/vote` | POST | `reviews:vote` | yes | `{ customerRef: string.min(1), helpful: boolean }` |
| `/reviews/:reviewId/report` | POST | `reviews:report` | **no** | `{ reporterRef: string.min(1) }` |
| `/reviews/:reviewId/respond` | POST | `reviews:respond` | yes | `{ responseText: string.min(1) }` |
| `/reviews/:reviewId/moderate` | POST | `reviews:moderate` | yes | `{ actionId: string.min(1), action: "reject"\|"flag"\|"restore"\|"remove", moderatorRef: string.min(1), reason?: string.min(1) }` — `actionId` is a client-minted replay-safety key, distinct from the `Idempotency-Key` header: mint a fresh one with `newIdempotencyKey()` (or reuse the same value) and send it in both places, same double-field pattern T5.8's coupon-redeem uses |
| `/reviews` (list, moderation queue) | GET | `reviews:read` | — | `{ first?, after?, last?, before?, status?: "pending"\|"published"\|"rejected"\|"flagged"\|"removed" }` |
| `/reviews/by-product/:productRef` (list) | GET | `reviews:read` | — | `{ first?, after?, last?, before? }` |
| `/reviews/:reviewId` (get) | GET | `reviews:read` | — | — |

## Review status transition table (copy verbatim as UI-only data)

Source: `services/reviews/src/domain/value-objects/review-status.ts`. Never import `services/*`
from `apps/*` — hand-copy into a new `lib/review-lifecycle.ts`, commented as a hand-kept copy, same
technique every prior Phase 5 lifecycle table used.

```
pending: [published, rejected]
published: [flagged, removed]
rejected: []
flagged: [published, removed]
removed: []
```

`moderate`'s 4 actions (`reject`/`flag`/`restore`/`remove`) map onto specific transitions
(`restore` presumably means flagged→published, the others are self-descriptive) — this is a
richer, audited alternative to the generic `advance` for moderator actions specifically. Prefer
`moderate` as the primary moderation control (it carries `moderatorRef`/`reason`, which `advance`
does not), and use the generic advance dropdown only as a fallback for any transition `moderate`'s
4 actions don't cover (check whether `reject`/`flag`/`remove`/`restore` cover every edge in the
table above — if they don't, the residual gets the generic dropdown, same
"DEDICATED_COVERED_TARGETS" pattern T5.4 established).

## What to build

1. `apps/admin-web/src/lib/api/reviews.ts` (new) — `fetchReviewsPage` (queue, with status filter),
   `fetchReviewsByProduct`, `fetchReview`, plus the 6 mutate functions.
2. `apps/admin-web/src/app/reviews/page.tsx` (new) — **the moderation queue**: a list defaulting to
   `status=pending` (with a status filter control, same querystring-driven pattern as
   `orders/page.tsx`'s status filter if one exists — check it), each row showing rating/bodyText
   excerpt/reportCount/verifiedPurchase, linking to the detail page. This is the primary screen —
   make it good, it's literally named "the review moderation queue" in the task title.
3. `apps/admin-web/src/app/reviews/[reviewId]/page.tsx` (new) — full detail: all DTO fields,
   moderation actions gated by the transition table (per above), vote/report forms (mostly for
   completeness/testing — these are customer actions in production, but the routes exist and the
   task lists them explicitly), respond form (merchant response — shows existing
   `merchantResponse` if set, form to set/replace it).
4. `apps/admin-web/src/app/reviews/new/page.tsx` (new, optional per the create-route note above —
   include it, keep it simple).
5. Navigation + `middleware.ts`: `reviews` nav entry, `["/reviews", "viewer"]` (queue is
   read-heavy, viewer-browsable), `["/reviews/new", "operator"]` (moderation actions are
   independently permission-gated server-side on the detail page, same precedent as every prior
   Phase 5 detail-page write action — viewer can view, backend rejects the actual submit).
6. Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (every Phase 5 task)

1. `packages/*`/`services/*` never import from `apps/*`; copy the transition table as data.
2. Domain aggregates never go on the wire — `ReviewDto` is already correctly typed.
3. Never fabricate data.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark this task's checkbox (`- [ ] **T5.10 Review moderation queue.**` → `- [x] ...`) when done.
8. One `Idempotency-Key` per user-initiated submit (see the `moderate`/`actionId` double-field note
   above for the one exception where a value is also needed in the body).
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.10-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
