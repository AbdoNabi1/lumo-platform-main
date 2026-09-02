import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

export interface CouponListItemDto {
  readonly id: string;
  readonly code: string;
  readonly promotionRef: string;
  readonly status: string;
  readonly usageLimit: number | null;
  readonly usageCount: number;
  readonly expiresAt: string | null;
}

export interface DiscountsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface CouponsPageDto {
  readonly items: readonly CouponListItemDto[];
  readonly pageInfo: DiscountsPageInfo;
}

function isCouponsPageDto(value: unknown): value is CouponsPageDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export type FetchCouponsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly CouponListItemDto[];
      readonly pageInfo: DiscountsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a cursor-paginated page of coupons for the Discounts list screen. */
export async function fetchCouponsPage(query: {
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchCouponsPageResult> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/coupons?${params.toString()}`, isCouponsPageDto);
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

/**
 * T5.8 — the 3 Coupons write routes (`apps/admin/src/http/coupons-routes.ts`). None of their
 * handlers map the response through a DTO (`admin.coupons.create`/`.advance`/`.redeem` all return
 * the `Coupon` aggregate or its own result directly) — same discipline `lib/api/products.ts`'s
 * doc comment describes for its own write routes: read only an `id` off a create response,
 * nothing off the rest, and let the caller `revalidatePath` the list to pick up the real,
 * DTO-mapped state.
 */

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

function isCreatedRecord(value: unknown): value is { readonly id?: unknown } {
  return typeof value === "object" && value !== null;
}

export interface CreateCouponInput {
  readonly code: string;
  readonly promotionRef: string;
  readonly multiUse: boolean;
  readonly usageLimit?: number;
  readonly customerRef?: string;
  readonly expiresAt?: string;
  readonly campaignRef?: string;
}

/** `POST /coupons` (`idempotent: true`, `coupons:create`). */
export async function createCoupon(
  input: CreateCouponInput,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly id: string }>> {
  const result = await mutateAdminApi(
    "/api/v1/coupons",
    { method: "POST", body: input, idempotencyKey },
    isCreatedRecord,
  );
  if (result.outcome !== "ok") return result;
  const id = typeof result.data.id === "string" ? result.data.id : "";
  return { outcome: "ok", data: { id } };
}

/** `POST /coupons/:couponId/transitions` (`idempotent: true`, `coupons:advance`). */
export function advanceCoupon(
  couponId: string,
  toStatus: "active" | "disabled" | "expired" | "depleted",
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    `/api/v1/coupons/${encodeURIComponent(couponId)}/transitions`,
    { method: "POST", body: { toStatus }, idempotencyKey },
    isUnknown,
  );
}

export interface RedeemCouponInput {
  readonly code: string;
  readonly customerRef: string;
  readonly orderRef?: string;
}

/**
 * `POST /coupons/redeem` (`idempotent: true`, `coupons:redeem`). Unlike every other write route
 * in this codebase, the redeem body carries its own `idempotencyKey` field in addition to the
 * `Idempotency-Key` HTTP header `mutateAdminApi` already sends — the caller mints ONE value and
 * this function threads it into both places, never two different values.
 */
export function redeemCoupon(
  input: RedeemCouponInput,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/coupons/redeem",
    { method: "POST", body: { ...input, idempotencyKey }, idempotencyKey },
    isUnknown,
  );
}
