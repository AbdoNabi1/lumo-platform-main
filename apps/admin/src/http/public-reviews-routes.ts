import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Review } from "@platform/reviews";
import type { Paginated } from "@platform/types";
import type { WiredAdmin } from "../composition";
import { mapPage, type PageResponse } from "./public-catalog-routes";
import { resolveCustomerSessionId } from "./public-auth-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});
const productRefParams = z.object({ productRef: z.string().min(1) });
const reviewIdParams = z.object({ reviewId: z.string().min(1) });

/**
 * Creating a review. **No `customerRef` field** — the admin-facing `createReviewBody`
 * (`reviews-routes.ts`) has one because an operator legitimately creates a review record on a
 * customer's behalf; this public route must not expose that same freedom (T5.18-write's core
 * rule, mirroring T5.16 §3/T5.17's wishlist discipline). `.strict()` means a body that tries to
 * smuggle `customerRef` anyway fails validation (422) at the boundary rather than being silently
 * dropped — the same deliberate choice `public-auth-routes.ts`'s `emptyBody` documents.
 */
const createReviewBody = z
  .object({
    productRef: z.string().min(1),
    rating: z.number(),
    bodyText: z.string().min(1),
    assetRefs: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** No `customerRef` field — same reasoning as `createReviewBody` above. */
const voteReviewBody = z.object({ helpful: z.boolean() }).strict();

/** No `reporterRef` field — same reasoning as `createReviewBody` above; the reporter is always the session's own customer. */
const reportReviewBody = z.object({}).strict();

/** The minimal, honest result of a write — mirrors `ReviewStatusOutput` (`review.use-cases.ts`), not the full `Review` aggregate. */
export interface PublicReviewWriteResultDto {
  readonly reviewId: string;
  readonly status: string;
}

/** Projects a `ReviewStatusOutput`-shaped controller response through {@link PublicReviewWriteResultDto}, leaving errors untouched. */
function toWriteResult(response: PageResponse): PageResponse {
  if (response.status < 200 || response.status >= 300) return response;
  const { reviewId, status } = response.body as { reviewId: string; status: string };
  return { status: response.status, body: { reviewId, status } };
}

/**
 * The public review-display-AND-authoring surface (T5.18 display half + T5.18-write). Mounted the
 * same way as every other `public/*-routes.ts` file (same Runtime Gateway, `public: true` so the
 * pipeline skips authentication and the permission guard). Every route in `reviews-routes.ts` —
 * including its reads — is admin-guarded via `ReviewsAdminController`, which requires a
 * `Principal`; a storefront shopper reading a product page (or writing a review) has none. This
 * file reuses `admin.publicReads.reviews` (the raw, unguarded `ReviewsController` — see its doc
 * comment in `composition.ts`), the same convention `public-cart-routes.ts`/
 * `public-checkout-routes.ts` established, rather than calling the guarded controller with a
 * fabricated anonymous principal (which `public-catalog-routes.ts`'s own header comment already
 * warns either silently allows everything or silently denies everything depending on the
 * deployment's access-control backend).
 *
 * ── The write routes below (T5.18-write) ──
 * `POST /public/reviews`, `POST /public/reviews/:reviewId/vote`, and
 * `POST /public/reviews/:reviewId/report` were deferred from T5.18's display half until the
 * customer-identity decision existed (T5.16, then built by T5.17). It now does: every write route
 * below runs `admin.customerAuth.requireSession(...)` first and fails closed with the shared 401,
 * exactly like `public-wishlist-routes.ts`/`public-loyalty-routes.ts`. **The `customerRef`/
 * `reporterRef` is ALWAYS the session's own** — no schema below has either field, so there is
 * nothing for a malicious body to smuggle. `advance`/`respond`/`moderate` stay admin/
 * moderator-only (T5.10's territory) and are deliberately not exposed here — a customer does not
 * self-publish, self-respond-as-the-merchant, or self-moderate their own review.
 *
 * `verifiedPurchase` is decided entirely server-side by `CreateReview`'s injected `OrdersPort` —
 * nothing new needed here; the public route just never has a way to set it either way.
 *
 * ── Two privacy/correctness rules unique to this surface ──
 * 1. `PublicReviewDto` (below) is NOT `ReviewDto` narrowed by convention — it is a separate,
 *    deliberately smaller interface. `customerRef` (identifies a specific customer) and
 *    `reportCount` (an internal moderation signal) must never reach an anonymous public surface.
 *    `status` and `productRef` are also omitted: `status` because every item returned is already
 *    known-published (see rule 2), and `productRef` because the caller supplied it in the URL.
 * 2. `ListReviewsByProduct` (`services/reviews/src/application/list-reviews-by-product.use-case.ts`)
 *    delegates straight to `ReviewRepository.findByProductRef` with no status filter — confirmed by
 *    reading the use case, not assumed. It returns a review in ANY status, including `"pending"`
 *    (awaiting moderation) and `"flagged"`/`"removed"`. `publishedReviewsOnly` below is this route's
 *    own boundary filter, same rationale as `publishedOnly` in `public-catalog-routes.ts` for
 *    prices — except it must run BEFORE `toPublicReviewDto`, not after: `PublicReviewDto` has no
 *    `status` field for a post-mapping filter to inspect (rule 1), so the raw `Review` aggregate's
 *    `status.value` is the only place left to check.
 */

export interface PublicReviewDto {
  readonly id: string;
  readonly rating: number;
  readonly bodyText: string;
  readonly assetRefs: readonly string[];
  readonly verifiedPurchase: boolean;
  readonly helpfulCount: number;
  readonly unhelpfulCount: number;
  readonly merchantResponse: string | null;
}

/** Public review projection — see the file header comment for exactly why each field is present or withheld. */
function toPublicReviewDto(review: Review): PublicReviewDto {
  return {
    id: review.id.toString(),
    rating: review.rating.value,
    bodyText: review.bodyText,
    assetRefs: review.media.assetRefs,
    verifiedPurchase: review.verifiedPurchase,
    helpfulCount: review.helpfulCount,
    unhelpfulCount: review.unhelpfulCount,
    merchantResponse: review.merchantResponse ?? null,
  };
}

/** Filters the raw `Review` page to `status: "published"` before it is mapped to `PublicReviewDto` — see the file header's rule 2 for why this must run before, not after, the DTO mapping. */
function publishedReviewsOnly(response: PageResponse): PageResponse {
  if (response.status < 200 || response.status >= 300) return response;
  const page = response.body as Paginated<Review>;
  return {
    status: response.status,
    body: {
      items: page.items.filter((review) => review.status.value === "published"),
      pageInfo: page.pageInfo,
    },
  };
}

export function publicReviewsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/reviews/by-product/:productRef",
      version: 1,
      permission: "reviews:read",
      public: true,
      summary: "Public: list PUBLISHED reviews for one product (cursor pagination)",
      schema: { params: productRefParams, querystring: pageQuery },
      handle: async ({ params, query, context }) =>
        mapPage(
          publishedReviewsOnly(
            await admin.publicReads.reviews.listByProduct({
              productRef: params.productRef,
              ...query,
              tenantId: context.tenantId,
            }),
          ),
          toPublicReviewDto,
        ),
    }),
    defineRoute({
      method: "POST",
      path: "/public/reviews",
      version: 1,
      permission: "reviews:create",
      public: true,
      idempotent: true,
      summary:
        "Public: the signed-in customer creates a review (one per customer/product; verified-purchase decided server-side)",
      schema: { body: createReviewBody },
      handle: async ({ body, context }): Promise<PageResponse> => {
        const guarded = await admin.customerAuth.requireSession(
          resolveCustomerSessionId(context),
          context.tenantId,
        );
        if (!guarded.ok) return guarded.response;

        const created = await admin.publicReads.reviews.create({
          productRef: body.productRef,
          customerRef: guarded.session.customerRef,
          rating: body.rating,
          bodyText: body.bodyText,
          ...(body.assetRefs !== undefined ? { assetRefs: body.assetRefs } : {}),
          tenantId: context.tenantId,
        });
        return toWriteResult(created);
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/reviews/:reviewId/vote",
      version: 1,
      permission: "reviews:vote",
      public: true,
      idempotent: true,
      summary:
        "Public: the signed-in customer records (or replaces) a helpful/unhelpful vote on a review",
      schema: { params: reviewIdParams, body: voteReviewBody },
      handle: async ({ params, body, context }): Promise<PageResponse> => {
        const guarded = await admin.customerAuth.requireSession(
          resolveCustomerSessionId(context),
          context.tenantId,
        );
        if (!guarded.ok) return guarded.response;

        const voted = await admin.publicReads.reviews.vote({
          reviewId: params.reviewId,
          customerRef: guarded.session.customerRef,
          helpful: body.helpful,
          tenantId: context.tenantId,
        });
        return toWriteResult(voted);
      },
    }),
    defineRoute({
      method: "POST",
      path: "/public/reviews/:reviewId/report",
      version: 1,
      permission: "reviews:report",
      public: true,
      idempotent: true,
      summary:
        "Public: the signed-in customer records an abuse report (auto-flags once the threshold is reached)",
      schema: { params: reviewIdParams, body: reportReviewBody },
      handle: async ({ params, context }): Promise<PageResponse> => {
        const guarded = await admin.customerAuth.requireSession(
          resolveCustomerSessionId(context),
          context.tenantId,
        );
        if (!guarded.ok) return guarded.response;

        const reported = await admin.publicReads.reviews.report({
          reviewId: params.reviewId,
          reporterRef: guarded.session.customerRef,
          tenantId: context.tenantId,
        });
        return toWriteResult(reported);
      },
    }),
  ] as readonly RouteDefinition[];
}
