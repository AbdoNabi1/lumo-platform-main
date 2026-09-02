# Task T5.18-write report — Product review authoring (the deferred write half)

**Status: DONE.** All four verification commands pass. Nothing was blocked; no `BLOCKERS.md` entry
was needed.

## Scope delivered

`apps/admin/src/http/reviews-routes.ts` already had `POST /reviews` (create), `POST
/reviews/:reviewId/vote`, and `POST /reviews/:reviewId/report` — all admin-only, requiring a staff
`Principal`. This task exposed all three to a signed-in customer, session-scoped, on
`apps/admin/src/http/public-reviews-routes.ts` (the same file T5.18's display half already used
for `GET /public/reviews/by-product/:productRef`):

- `POST /public/reviews` — create a review. Body: `{ productRef, rating, bodyText, assetRefs? }`,
  `.strict()`. **No `customerRef` field.** The handler derives it from
  `admin.customerAuth.requireSession(resolveCustomerSessionId(context))` and injects
  `customerRef: guarded.session.customerRef` into the call to `admin.publicReads.reviews.create(...)`
  — the same pattern `public-wishlist-routes.ts` and `public-loyalty-routes.ts` established for
  T5.17/T5.19. `verifiedPurchase` is decided entirely server-side by `CreateReview`'s injected
  `OrdersPort` — nothing new was needed for that.
- `POST /public/reviews/:reviewId/vote` — record/replace a helpful/unhelpful vote. Body:
  `{ helpful: boolean }`, `.strict()`. No `customerRef` field.
- `POST /public/reviews/:reviewId/report` — record an abuse report. Body: `{}`, `.strict()`. No
  `reporterRef` field — the reporter is always the session's own customer.

I included vote/report (the brief left this as "your call") because they follow the exact same
session-scoping pattern as create with no new risk, and this is explicitly the third and last
consumer of the T5.17 foundation — closing out the full dispatch felt more honest than leaving an
identical, cheap extension for a fourth task later. `advance`/`respond`/`moderate` were **not**
exposed — those stay admin/moderator-only per the brief's explicit instruction.

All three write routes are `idempotent: true` (Idempotency-Key replay support) and `public: true`.

Response shape for all three writes is a small `PublicReviewWriteResultDto` (`{ reviewId, status
}`) — mirroring `ReviewStatusOutput`, the real (minimal) output the underlying use cases already
produce. A freshly created review is `status: "pending"`, which the schema/response make visible
so the frontend can render an honest "submitted, awaiting moderation" state rather than a
fabricated live review.

### `.strict()` verification (per the brief's explicit instruction)

Checked directly: zod's `.strict()` on an object schema rejects (fails `safeParse`, would 422 at
the real HTTP boundary) any body containing an unrecognized key — confirmed with a dedicated test
(`public-reviews-routes.test.ts`, "the .strict() schema itself rejects a customerRef field (422)")
that calls the actual exported zod schema's `.safeParse()` with a `customerRef` field present.
Deliberately chose `.strict()` over silent-ignore, matching `public-wishlist-routes.ts`'s
`productRefBody` and `public-auth-routes.ts`'s `emptyBody` — a client sending `customerRef` gets an
explicit rejection, not silent success that could mask a bug.

Route-`.handle()`-level tests (which bypass the zod layer entirely, same as every other file in
this codebase's test suite) additionally confirm the second line of defense: even if a
`customerRef`/`reporterRef` field somehow reached the handler, it is never read off `body` — the
created/voted/reported review is always scoped to the session's own `customerRef`, verified against
another signed-in customer's id.

## Backend

**File touched:** `apps/admin/src/http/public-reviews-routes.ts` (extended, not replaced — the
existing `GET /public/reviews/by-product/:productRef` display route is untouched).

**Test file touched:** `apps/admin/src/http/public-reviews-routes.test.ts` (extended). Kept the
existing display-half tests using the lightweight `stubAdmin` (no session concept needed for an
anonymous read). Added a second harness for the write half, driving REAL `wireSecurity`/
`wireIdentity`/`wireReviews` compositions through real customer sessions established by
`public-auth-routes.ts`'s own routes — same discipline `public-wishlist-routes.test.ts`/
`public-loyalty-routes.test.ts` use, because the dominant risk on a write surface is a caller
supplying someone else's identity, which only a real session boundary proves doesn't work. New
coverage:

- `POST /public/reviews`: creates scoped to the session's customer; a client-supplied `customerRef`
  in the body is ignored (verified against another real customer's id) even though `.handle()`
  bypasses the zod layer; the `.strict()` schema itself rejects a `customerRef` field (422) when
  exercised directly via `safeParse`; 401s for an anonymous caller with no review created;
  `verifiedPurchase` is decided server-side (false, via the default `InMemoryOrdersPort`).
- `POST /public/reviews/:reviewId/vote`: records under the session's own `customerRef`, not a
  client-supplied one; 401s anonymously.
- `POST /public/reviews/:reviewId/report`: records under the session's own `customerRef` as
  `reporterRef`, not a client-supplied one; 401s anonymously.
- Route declarations: every write route is `public: true` with no `:customerRef`/`:reporterRef` in
  its path.

No changes were needed in `services/reviews`, `packages/*`, or `apps/admin-web` — the
`CreateReview`/`VoteReview`/`ReportReview` use cases and the raw `ReviewsController` already existed
and already accepted exactly the shape needed (confirmed by reading
`services/reviews/src/application/review.use-cases.ts` and
`services/reviews/src/interfaces/reviews.controller.ts` before writing any code). This matches the
brief's own framing — T5.17/T5.19 already proved the foundation works; this task's job was wiring,
not building new domain surface.

## Frontend (`apps/storefront`)

- **`src/lib/runtime-api.ts`** (extended) — `createProductReview(sessionId, input, idempotencyKey)`,
  posting to `/api/v1/public/reviews` with the session id in the `x-customer-session` header (same
  transport convention as every other customer-scoped write) and a fresh `Idempotency-Key` per call.
  `CreateProductReviewInput`/`ProductReviewWriteResult` types added; no `customerRef` field on
  either.
- **`src/app/products/[slug]/actions.ts`** (new) — `submitProductReview(slug, productRef, rating,
  bodyText)` Server Action. Reads `CUSTOMER_SESSION_COOKIE` server-side (never passed to the
  client), mints one `Idempotency-Key` (`crypto.randomUUID()`) per submit, and maps the response to
  `{ ok: true, status }` or `{ ok: false, reason: "signed-out" | "duplicate" | "validation" |
  "network" }` — `"duplicate"` surfaces the backend's 409 (one review per customer/product) as an
  honest, distinct state rather than a generic error. Revalidates `/products/[slug]` on success.
- **`src/components/write-review-form.tsx`** (new) — `WriteReviewForm`, a Client Component with a
  rating `<select>` (1-5) and a `bodyText` `<textarea>`, submitting via `useTransition`. Shows a
  "submitted, awaiting moderation" message on success (never claims the review is now live/visible).
- **`src/app/products/[slug]/page.tsx`** (extended) — added a card between the product card and the
  reviews list: renders `<WriteReviewForm>` when `resolveCurrentCustomer(...)` returns
  `"signed-in"`, a sign-in link when `"signed-out"`, and **nothing** when `"error"` (session
  unverifiable) — the same three-way discipline `AddToWishlistButton`'s gating already established
  on this same page, extended to cover the new form too (previously that discipline only covered
  the wishlist button; the doc comments on the `Promise.all` block and the wishlist button were
  updated to say so).
- **Dictionaries** (`src/messages/en.ts`, `src/messages/ar.ts`) — added `product.reviewForm.{title,
  ratingLabel, bodyLabel, submit, submitting, success, signInPrompt, errors.{duplicate, validation,
  network}}` to both locale files (English and the Arabic RTL translation), keeping the shared
  `Dictionary` shape `en.ts` defines in sync — confirmed by `pnpm --filter storefront typecheck`
  (the second locale is typed against the first's shape) and the existing `lib/i18n.test.ts` parity
  tests.

**Test files touched:** `src/app/products/[slug]/actions.test.ts` (new) — mirrors
`app/account/wishlist/actions.test.ts`'s structure. Covers: session id + fields + fresh
Idempotency-Key sent with no `customerRef`/id field at all (asserted via `toHaveLength(3)` on the
call args); refuses without a session and never calls the API; maps 401→`signed-out`,
409→`duplicate`, 422→`validation`; fresh idempotency key per submit; revalidates on success only,
never on failure. No test file was added for `write-review-form.tsx` itself — this matches the
existing convention in this codebase (`add-to-wishlist-button.tsx` also has no test file; its
Server Action is what's tested), and `pnpm --filter storefront lint`/`typecheck` both pass on the
component.

## Global constraints checked

1. `packages/*`/`services/*` never import from `apps/*` — untouched, no change needed; `pnpm arch`
   passes (1637 modules, 7476 dependencies cruised, no violations).
2. Domain aggregates never go on the wire — `PublicReviewWriteResultDto` is a hand-typed, flat
   interface (`{ reviewId: string; status: string }`), not the `Review` aggregate.
3. No new route accepts a client-supplied `customerRef`/`reporterRef` — verified by schema
   inspection, `.strict()` rejection test, and a same-session-different-customer test.
4. Every new user-facing string is in both `en.ts` and `ar.ts`.
5. No `git` commands were run (repo has no `.git`, per the task's own framing).
6. No questions were asked; nothing was blocked, so no `BLOCKERS.md` entry was added.
7. `PHASE-5-6-backlog.md`'s T5.18 line (already `[x]`) got an added note pointing at this report,
   not a re-tick.
8. One `Idempotency-Key` per user-initiated submit on every new write route — all three backend
   routes are `idempotent: true`, and the one frontend write path mints a fresh
   `crypto.randomUUID()` per `submitProductReview` call (test-covered).
9. The storefront calls the runtime API only from the Server Action (`actions.ts`) and the Server
   Component (`page.tsx`) — `write-review-form.tsx` is a Client Component but never imports
   `runtime-api.ts` directly; it only calls the Server Action.

## Verification (run synchronously, output observed directly — not summarized from memory)

```
pnpm --filter @platform/admin typecheck   → tsc --noEmit, no errors
pnpm --filter @platform/admin test        → 44 test files, 344 tests passed
pnpm --filter storefront typecheck        → tsc --noEmit, no errors
pnpm --filter storefront lint             → eslint ., no errors
pnpm --filter storefront test             → 17 test files, 165 tests passed
pnpm arch                                 → no dependency violations found (1637 modules, 7476 dependencies cruised)
```

All six commands passed cleanly on this Windows host without needing any of the `turbo`-avoidance
workarounds documented earlier in `BLOCKERS.md` (this project's root-level scripts already
delegate per-package via `pnpm --filter`, and `pnpm arch` runs `depcruise` directly, not through
`turbo`).

## Files changed

**Backend:**
- `apps/admin/src/http/public-reviews-routes.ts` (extended)
- `apps/admin/src/http/public-reviews-routes.test.ts` (extended)

**Frontend:**
- `apps/storefront/src/lib/runtime-api.ts` (extended)
- `apps/storefront/src/app/products/[slug]/actions.ts` (new)
- `apps/storefront/src/app/products/[slug]/actions.test.ts` (new)
- `apps/storefront/src/components/write-review-form.tsx` (new)
- `apps/storefront/src/app/products/[slug]/page.tsx` (extended)
- `apps/storefront/src/messages/en.ts` (extended)
- `apps/storefront/src/messages/ar.ts` (extended)

**Docs:**
- `docs/plans/PHASE-5-6-backlog.md` (note added to the already-ticked T5.18 line)
- `docs/plans/.progress/task-T5.18-write-report.md` (this file)

## Concerns / follow-ups for a later task (not blockers)

- The frontend does not expose vote/report UI, even though the backend routes for both now exist.
  The brief's "What to build → Frontend" checklist only asked for `createProductReview` + a
  submission form + dictionary strings, so I scoped the frontend to exactly that rather than
  building UI the brief didn't ask for. A follow-up task can wire helpful/unhelpful vote buttons and
  a "report" action onto `ProductReviews`' existing review list against the now-ready
  `POST /public/reviews/:reviewId/{vote,report}` routes with no backend change needed.
- A submitted review does not appear anywhere in the UI immediately after submission (it is
  `"pending"`, and the published list only shows `"published"` reviews) — the success message says
  so explicitly ("submitted and is awaiting moderation") rather than implying it will show up. This
  is a deliberate honesty choice, not a bug: building a "your own pending reviews" view was outside
  this task's stated scope and there is no route that would support it without adding a
  status-inclusive "my reviews" read to the raw `ReviewsController`, which the brief did not ask
  for.
