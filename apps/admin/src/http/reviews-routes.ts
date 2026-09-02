import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Review } from "@platform/reviews";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});
const reviewListQuery = pageQuery.extend({
  status: z.enum(["pending", "published", "rejected", "flagged", "removed"]).optional(),
});
const productRefParams = z.object({ productRef: z.string().min(1) });

export interface ReviewDto {
  readonly id: string;
  readonly productRef: string;
  readonly customerRef: string;
  readonly rating: number;
  readonly bodyText: string;
  readonly assetRefs: readonly string[];
  readonly verifiedPurchase: boolean;
  readonly status: string;
  readonly helpfulCount: number;
  readonly unhelpfulCount: number;
  readonly reportCount: number;
  readonly merchantResponse: string | null;
}

function toReviewDto(review: Review): ReviewDto {
  return {
    id: review.id.toString(),
    productRef: review.productRef,
    customerRef: review.customerRef,
    rating: review.rating.value,
    bodyText: review.bodyText,
    assetRefs: review.media.assetRefs,
    verifiedPurchase: review.verifiedPurchase,
    status: review.status.value,
    helpfulCount: review.helpfulCount,
    unhelpfulCount: review.unhelpfulCount,
    reportCount: review.reportCount,
    merchantResponse: review.merchantResponse ?? null,
  };
}

const createReviewBody = z.object({
  productRef: z.string().min(1),
  customerRef: z.string().min(1),
  rating: z.number(),
  bodyText: z.string().min(1),
  assetRefs: z.array(z.string().min(1)).optional(),
});
const reviewIdParams = z.object({ reviewId: z.string().min(1) });
const advanceReviewBody = z.object({
  toStatus: z.enum(["pending", "published", "rejected", "flagged", "removed"]),
});
const voteReviewBody = z.object({
  customerRef: z.string().min(1),
  helpful: z.boolean(),
});
const reportReviewBody = z.object({ reporterRef: z.string().min(1) });
const respondReviewBody = z.object({ responseText: z.string().min(1) });
const moderateReviewBody = z.object({
  actionId: z.string().min(1),
  action: z.enum(["reject", "flag", "restore", "remove"]),
  moderatorRef: z.string().min(1),
  reason: z.string().min(1).optional(),
});

/** The Reviews admin HTTP surface (Sprint S1). Pure delegation. */
export function reviewsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/reviews",
      version: 1,
      permission: "reviews:create",
      idempotent: true,
      summary:
        "Create a review (one per customer/product; verified-purchase decided by OrdersPort)",
      schema: { body: createReviewBody },
      handle: ({ body, context }) => admin.reviews.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/reviews/:reviewId/transitions",
      version: 1,
      permission: "reviews:advance",
      idempotent: true,
      summary: "Advance a review's status (publish/reject/flag/remove)",
      schema: { params: reviewIdParams, body: advanceReviewBody },
      handle: ({ params, body, context }) =>
        admin.reviews.advance(context.principal, { reviewId: params.reviewId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/reviews/:reviewId/vote",
      version: 1,
      permission: "reviews:vote",
      idempotent: true,
      summary: "Record (or replace) a helpful/unhelpful vote",
      schema: { params: reviewIdParams, body: voteReviewBody },
      handle: ({ params, body, context }) =>
        admin.reviews.vote(context.principal, { reviewId: params.reviewId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/reviews/:reviewId/report",
      version: 1,
      permission: "reviews:report",
      summary: "Record an abuse report (auto-flags once the threshold is reached)",
      schema: { params: reviewIdParams, body: reportReviewBody },
      handle: ({ params, body, context }) =>
        admin.reviews.report(context.principal, { reviewId: params.reviewId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/reviews/:reviewId/respond",
      version: 1,
      permission: "reviews:respond",
      idempotent: true,
      summary: "Record the merchant's response to a review",
      schema: { params: reviewIdParams, body: respondReviewBody },
      handle: ({ params, body, context }) =>
        admin.reviews.respond(context.principal, { reviewId: params.reviewId, ...body }),
    }),
    defineRoute({
      method: "POST",
      path: "/reviews/:reviewId/moderate",
      version: 1,
      permission: "reviews:moderate",
      idempotent: true,
      summary: "Apply a moderator action (replay-safe by actionId)",
      schema: { params: reviewIdParams, body: moderateReviewBody },
      handle: ({ params, body, context }) =>
        admin.reviews.moderate(context.principal, { reviewId: params.reviewId, ...body }),
    }),
    defineRoute({
      method: "GET",
      path: "/reviews",
      version: 1,
      permission: "reviews:read",
      summary: "List reviews (cursor pagination; an optional status filter is the moderation queue)",
      schema: { querystring: reviewListQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.reviews.list(context.principal, query), toReviewDto),
    }),
    defineRoute({
      method: "GET",
      path: "/reviews/by-product/:productRef",
      version: 1,
      permission: "reviews:read",
      summary: "List reviews for one product (cursor pagination)",
      schema: { params: productRefParams, querystring: pageQuery },
      handle: async ({ params, query, context }) =>
        mapPage(
          await admin.reviews.listByProduct(context.principal, { productRef: params.productRef, ...query }),
          toReviewDto,
        ),
    }),
    defineRoute({
      method: "GET",
      path: "/reviews/:reviewId",
      version: 1,
      permission: "reviews:read",
      summary: "Get one review by id",
      schema: { params: reviewIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.reviews.get(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toReviewDto(response.body as Review) };
      },
    }),
  ] as readonly RouteDefinition[];
}
