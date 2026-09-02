import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * T5.10 — Review moderation queue (`apps/admin/src/http/reviews-routes.ts`). List/list-by-product/
 * get are fully DTO-mapped on the backend (`toReviewDto`), so the read side here follows
 * `lib/api/pages.ts`'s `fetchPagesPage`/`fetchPage` pattern exactly. The 6 write routes don't map
 * their responses through `toReviewDto` (`ReviewsAdminController`'s `create`/`advance`/`vote`/
 * `report`/`respond`/`moderate` return whatever `ReviewsController` returns directly, unmapped) —
 * same discipline `lib/api/pages.ts`'s doc comment describes for its own write routes: read only an
 * `id` off a create response, nothing off the rest, and let the caller `revalidatePath` to pick up
 * the real, DTO-mapped state.
 */

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

export interface ReviewsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface ReviewsPageDto {
  readonly items: readonly ReviewDto[];
  readonly pageInfo: ReviewsPageInfo;
}

function isReviewsPageDto(value: unknown): value is ReviewsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function isReviewDto(value: unknown): value is ReviewDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export type ReviewStatus = "pending" | "published" | "rejected" | "flagged" | "removed";

export type FetchReviewsPageResult =
  | { readonly outcome: "ok"; readonly items: readonly ReviewDto[]; readonly pageInfo: ReviewsPageInfo }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * Fetches a cursor-paginated page of reviews for the moderation queue (`GET /reviews`,
 * `reviews:read`) — the queue's `status` filter is what turns this generic list into "the
 * moderation queue" (`app/reviews/page.tsx` defaults it to `pending`). Only `first`/`after` are
 * sent for pagination (matching `lib/api/orders.ts`/`lib/api/pages.ts`'s own forward-cursor-only
 * convention) even though the backend's querystring also accepts `last`/`before` — every
 * `pageInfo` in this app is `{ hasNextPage, endCursor }` only (`packages/types/src/index.ts`'s
 * `Paginated`), so there is no backward cursor to send in the first place.
 */
export async function fetchReviewsPage(query: {
  readonly first?: number;
  readonly after?: string;
  readonly status?: ReviewStatus;
}): Promise<FetchReviewsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.status !== undefined) params.set("status", query.status);

  const result = await getAdminApi(`/api/v1/reviews?${params.toString()}`, isReviewsPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

/** Fetches a cursor-paginated page of reviews for one product (`GET /reviews/by-product/:productRef`, `reviews:read`). */
export async function fetchReviewsByProduct(
  productRef: string,
  query: { readonly first?: number; readonly after?: string },
): Promise<FetchReviewsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(
    `/api/v1/reviews/by-product/${encodeURIComponent(productRef)}?${params.toString()}`,
    isReviewsPageDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") {
    return { outcome: "unauthorized" };
  }
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export type FetchReviewResult =
  | { readonly outcome: "ok"; readonly review: ReviewDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a single review for the Review Detail screen (`GET /reviews/:reviewId`, `reviews:read`). */
export async function fetchReview(reviewId: string): Promise<FetchReviewResult> {
  const result = await getAdminApi(
    `/api/v1/reviews/${encodeURIComponent(reviewId)}`,
    isReviewDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", review: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}

function isCreatedRecord(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

export interface CreateReviewInput {
  readonly productRef: string;
  readonly customerRef: string;
  readonly rating: number;
  readonly bodyText: string;
  readonly assetRefs?: readonly string[];
}

/**
 * `POST /reviews` (`idempotent: true`, `reviews:create`). Normally customer-initiated (T5.18, the
 * storefront), but this admin console can also create one directly (e.g. for support/testing) —
 * see `app/reviews/new/page.tsx`.
 */
export async function createReview(
  input: CreateReviewInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/reviews",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

/** `POST /reviews/:reviewId/transitions` (`idempotent: true`, `reviews:advance`) — the generic fallback for the one transition `moderate` doesn't dedicate an action to (`pending` -> `published`). */
export function advanceReview(
  reviewId: string,
  toStatus: ReviewStatus,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/reviews/${encodeURIComponent(reviewId)}/transitions`,
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

/** `POST /reviews/:reviewId/vote` (`idempotent: true`, `reviews:vote`) — normally a customer action; offered here mostly for completeness/testing. */
export function voteReview(
  reviewId: string,
  input: { readonly customerRef: string; readonly helpful: boolean },
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/reviews/${encodeURIComponent(reviewId)}/vote`,
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}

/** `POST /reviews/:reviewId/report` (**not** idempotent — no `Idempotency-Key` sent, per the route table) — normally a customer action; offered here mostly for completeness/testing. */
export function reportReview(
  reviewId: string,
  input: { readonly reporterRef: string },
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/reviews/${encodeURIComponent(reviewId)}/report`,
    { method: "POST", body: input },
    isUnknown,
  );
}

/** `POST /reviews/:reviewId/respond` (`idempotent: true`, `reviews:respond`) — sets or replaces the merchant response. */
export function respondToReview(
  reviewId: string,
  responseText: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/reviews/${encodeURIComponent(reviewId)}/respond`,
    { method: "POST", body: { responseText }, idempotencyKey },
    isUnknown,
  );
}

export type ModerateReviewAction = "reject" | "flag" | "restore" | "remove";

/**
 * `POST /reviews/:reviewId/moderate` (`idempotent: true`, `reviews:moderate`) — the primary
 * moderation control (carries `moderatorRef`/`reason`, which the generic `advance` does not).
 * `actionId` is a client-minted replay-safety key, distinct from the `Idempotency-Key` header:
 * callers pass the same `newIdempotencyKey()` value for both (see `app/reviews/actions.ts`'s
 * `moderateReviewAction`), same double-field pattern the brief's `moderate` route note describes.
 */
export function moderateReview(
  reviewId: string,
  input: {
    readonly actionId: string;
    readonly action: ModerateReviewAction;
    readonly moderatorRef: string;
    readonly reason?: string;
  },
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/reviews/${encodeURIComponent(reviewId)}/moderate`,
    { method: "POST", body: input, idempotencyKey },
    isUnknown,
  );
}
