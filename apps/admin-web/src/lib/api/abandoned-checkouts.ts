import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";

/** Order operations Part 3 — the wire shapes of `apps/admin`'s `abandoned-checkout-dto.ts`. */
export type AbandonedRecoveryStatus = "not_recovered" | "recovered";

export interface AbandonedCheckoutListItemDto {
  readonly id: string;
  readonly reference: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly customerName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly itemCount: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly recoveryStatus: AbandonedRecoveryStatus;
  readonly recoveredOrder: { readonly id: string; readonly orderNumber: string | null } | null;
  readonly lastLinkIssuedAt: string | null;
}

export interface AbandonedCheckoutLineDto {
  readonly productId: string;
  readonly variantId: string | null;
  readonly title: string | null;
  readonly variantTitle: string | null;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly imageUrl: string | null;
}

export interface AbandonedCheckoutTotalsDto {
  readonly subtotalMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly taxIncluded: boolean;
}

export interface AbandonedCheckoutAddressDto {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface AbandonedCheckoutLinkDto {
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly claimCount: number;
  readonly lastClaimedAt: string | null;
}

export interface AbandonedCheckoutDetailDto extends AbandonedCheckoutListItemDto {
  readonly items: readonly AbandonedCheckoutLineDto[];
  readonly totals: AbandonedCheckoutTotalsDto | null;
  readonly shippingAddress: AbandonedCheckoutAddressDto | null;
  readonly links: readonly AbandonedCheckoutLinkDto[];
}

export interface AbandonedCheckoutsPageDto {
  readonly items: readonly AbandonedCheckoutListItemDto[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

export interface AbandonedCheckoutsQuery {
  readonly first?: number;
  readonly after?: string;
  readonly q?: string;
  readonly recovery?: AbandonedRecoveryStatus;
}

export interface RecoveryLinkDto {
  readonly url: string | null;
  readonly path: string;
  readonly expiresAt: string;
  readonly shopName: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPage(value: unknown): value is AbandonedCheckoutsPageDto {
  return isObject(value) && Array.isArray(value["items"]) && isObject(value["pageInfo"]);
}

function isDetail(value: unknown): value is AbandonedCheckoutDetailDto {
  return (
    isObject(value) &&
    typeof value["id"] === "string" &&
    Array.isArray(value["items"]) &&
    Array.isArray(value["links"])
  );
}

function isRecoveryLink(value: unknown): value is RecoveryLinkDto {
  return (
    isObject(value) &&
    typeof value["path"] === "string" &&
    (value["url"] === null || typeof value["url"] === "string") &&
    typeof value["expiresAt"] === "string" &&
    typeof value["shopName"] === "string"
  );
}

const basePath = "/api/v1/abandoned-checkouts";
const checkoutPath = (id: string, suffix = "") => `${basePath}/${encodeURIComponent(id)}${suffix}`;

/** `GET /abandoned-checkouts` (`orders:read`). Server code only. */
export function fetchAbandonedCheckouts(
  query: AbandonedCheckoutsQuery,
): Promise<ApiResult<AbandonedCheckoutsPageDto>> {
  const params = new URLSearchParams();
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  if (query.q !== undefined && query.q !== "") params.set("q", query.q);
  if (query.recovery !== undefined) params.set("recovery", query.recovery);
  const search = params.toString();
  return getAdminApi(search === "" ? basePath : `${basePath}?${search}`, isPage);
}

/** `GET /abandoned-checkouts/:id` (`orders:read`). */
export function fetchAbandonedCheckout(id: string): Promise<ApiResult<AbandonedCheckoutDetailDto>> {
  return getAdminApi(checkoutPath(id), isDetail);
}

/**
 * `POST /abandoned-checkouts/:id/recovery-link` (`orders:recover_checkout`). NOT idempotent: every call
 * mints a new token, and the plaintext token must never be cached or replayed, so no
 * `Idempotency-Key` is sent (the route would not store the response under one either).
 */
export function issueRecoveryLink(id: string): Promise<MutationResult<RecoveryLinkDto>> {
  return mutateAdminApi(checkoutPath(id, "/recovery-link"), { method: "POST" }, isRecoveryLink);
}
