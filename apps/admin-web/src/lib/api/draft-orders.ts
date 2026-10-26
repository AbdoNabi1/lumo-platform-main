import { getAdminApi, mutateAdminApi, type ApiResult, type MutationResult } from "./client";

/** Order operations Part 4 — the wire shapes of `apps/admin`'s `draft-order-dto.ts`. */
export type DraftOrderStatus = "open" | "invoice_sent" | "completed";
export type DraftRequirement = "lines" | "shipping_address" | "shipping" | "email";
export type DraftPayment = "paid" | "collect_on_delivery";

export interface DraftAddressDto {
  readonly name: string | null;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly province: string | null;
  readonly postalCode: string;
  readonly country: string;
}

export interface DraftLineDto {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly imageUrl: string | null;
}

export interface DraftTotalsDto {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number | null;
  readonly taxIncluded: boolean;
  readonly totalMinor: number;
}

export interface DraftOrderDto {
  readonly id: string;
  readonly draftNumber: string;
  readonly status: DraftOrderStatus;
  readonly version: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly invoiceSentAt: string | null;
  readonly completedAt: string | null;
  readonly customer: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly shippingAddress: DraftAddressDto | null;
  readonly billingAddress: DraftAddressDto | null;
  readonly lines: readonly DraftLineDto[];
  readonly discount: {
    readonly valueType: "fixed" | "percentage";
    readonly value: number;
    readonly reason: string | null;
    readonly amountMinor: number;
  } | null;
  readonly shipping: {
    readonly kind: "rate" | "custom" | "free";
    readonly method: string | null;
    readonly title: string;
    readonly amountMinor: number;
  } | null;
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly totals: DraftTotalsDto;
  readonly order: { readonly id: string; readonly orderNumber: string | null } | null;
  readonly links: readonly {
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly claimCount: number;
    readonly lastClaimedAt: string | null;
  }[];
  readonly missing: {
    readonly invoice: readonly DraftRequirement[];
    readonly complete: readonly DraftRequirement[];
  };
}

export interface DraftOrderListItemDto {
  readonly id: string;
  readonly draftNumber: string;
  readonly createdAt: string;
  readonly customerName: string | null;
  readonly status: DraftOrderStatus;
  readonly totalMinor: number;
  readonly currency: string;
  readonly orderRef: string | null;
  readonly orderNumber: string | null;
}

export interface DraftOrdersPageDto {
  readonly items: readonly DraftOrderListItemDto[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

export interface DraftAddressInput {
  readonly name?: string;
  readonly phone?: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly province?: string;
  readonly postalCode?: string;
  readonly country: string;
}

/** What the browser may send: ids, quantities and the merchant's own terms — never a line price. */
export interface DraftOrderInput {
  readonly customerId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly shippingAddress: DraftAddressInput | null;
  readonly billingAddress: DraftAddressInput | null;
  readonly lines: readonly {
    readonly productId: string;
    readonly variantId?: string;
    readonly quantity: number;
  }[];
  readonly discount: {
    readonly valueType: "fixed" | "percentage";
    readonly value: number;
    readonly reason?: string;
  } | null;
  readonly shipping:
    | { readonly kind: "rate"; readonly method: string }
    | { readonly kind: "custom"; readonly title: string; readonly amountMinor: number }
    | { readonly kind: "free" }
    | null;
  readonly note: string | null;
  readonly tags: readonly string[];
}

export interface DraftShippingRateDto {
  readonly method: string;
  readonly title: string;
  readonly amountMinor: number;
}

export interface InvoiceLinkDto {
  readonly url: string | null;
  readonly path: string;
  readonly expiresAt: string;
  readonly shopName: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isPage = (value: unknown): value is DraftOrdersPageDto =>
  isObject(value) && Array.isArray(value["items"]) && isObject(value["pageInfo"]);
const isDraft = (value: unknown): value is DraftOrderDto =>
  isObject(value) &&
  typeof value["id"] === "string" &&
  typeof value["draftNumber"] === "string" &&
  Array.isArray(value["lines"]);
const isRates = (value: unknown): value is { readonly rates: readonly DraftShippingRateDto[] } =>
  isObject(value) && Array.isArray(value["rates"]);
const isInvoiceLink = (value: unknown): value is InvoiceLinkDto =>
  isObject(value) &&
  typeof value["path"] === "string" &&
  (value["url"] === null || typeof value["url"] === "string");
const isCompleted = (
  value: unknown,
): value is { readonly orderId: string; readonly orderNumber: string | null } =>
  isObject(value) && typeof value["orderId"] === "string";
const isDeleted = (value: unknown): value is { readonly draftId: string } =>
  isObject(value) && typeof value["draftId"] === "string";

const basePath = "/api/v1/draft-orders";
const draftPath = (id: string, suffix = "") => `${basePath}/${encodeURIComponent(id)}${suffix}`;

/** `GET /draft-orders` (`orders:read`). Server code only. */
export function fetchDraftOrders(query: {
  readonly status?: DraftOrderStatus;
  readonly q?: string;
  readonly first?: number;
  readonly after?: string;
}): Promise<ApiResult<DraftOrdersPageDto>> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set("status", query.status);
  if (query.q !== undefined && query.q !== "") params.set("q", query.q);
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);
  const search = params.toString();
  return getAdminApi(search === "" ? basePath : `${basePath}?${search}`, isPage);
}

export function fetchDraftOrder(id: string): Promise<ApiResult<DraftOrderDto>> {
  return getAdminApi(draftPath(id), isDraft);
}

export function createDraftOrder(
  input: DraftOrderInput,
  idempotencyKey: string,
): Promise<MutationResult<DraftOrderDto>> {
  return mutateAdminApi(basePath, { method: "POST", body: input, idempotencyKey }, isDraft);
}

export function updateDraftOrder(
  id: string,
  input: DraftOrderInput & { readonly version: number },
  idempotencyKey: string,
): Promise<MutationResult<DraftOrderDto>> {
  return mutateAdminApi(draftPath(id), { method: "PUT", body: input, idempotencyKey }, isDraft);
}

export function deleteDraftOrder(
  id: string,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly draftId: string }>> {
  return mutateAdminApi(draftPath(id), { method: "DELETE", idempotencyKey }, isDeleted);
}

export function fetchDraftShippingRates(
  id: string,
): Promise<MutationResult<{ readonly rates: readonly DraftShippingRateDto[] }>> {
  return mutateAdminApi(draftPath(id, "/shipping-rates"), { method: "POST" }, isRates);
}

/**
 * `POST /draft-orders/:id/invoice-link` (`orders:draft`). NOT idempotent: every call mints a new token,
 * and the plaintext token must never be cached or replayed, so no `Idempotency-Key` is sent.
 */
export function issueDraftInvoiceLink(id: string): Promise<MutationResult<InvoiceLinkDto>> {
  return mutateAdminApi(draftPath(id, "/invoice-link"), { method: "POST" }, isInvoiceLink);
}

export function completeDraftOrder(
  id: string,
  payment: DraftPayment,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly orderId: string; readonly orderNumber: string | null }>> {
  return mutateAdminApi(
    draftPath(id, "/complete"),
    { method: "POST", body: { payment }, idempotencyKey },
    isCompleted,
  );
}
