import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

/**
 * Phase 2 Part 2 — the admin `/discounts` API (`apps/admin/src/http/discounts-routes.ts`): Shopify's
 * discounts, one facade over Promotions (the rule) and Coupons (the code). Reads need
 * `promotions:read`, every write `promotions:create` and is idempotent. The types mirror
 * `apps/admin/src/interfaces/discounts/discount-dto.ts` and `discount-input.ts`.
 */

/** Shopify's four types, in the order its "Select discount type" dialog lists them. */
export const DISCOUNT_TYPES = [
  "amount_off_products",
  "buy_x_get_y",
  "amount_off_order",
  "free_shipping",
] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];
export type DiscountMethod = "code" | "automatic";
export type DiscountStatus = "active" | "scheduled" | "expired";
/** The list's tabs. */
export const DISCOUNT_VIEWS = ["all", "active", "scheduled", "expired"] as const;
export type DiscountView = (typeof DISCOUNT_VIEWS)[number];
export type TargetScope = "products" | "categories";
/** Shopify's combination classes. */
export type DiscountClass = "product" | "order" | "shipping";

export interface DiscountValue {
  readonly kind: "percentage" | "fixed_amount";
  /** A percentage (0–100, two decimals) or minor units. */
  readonly amount: number;
}

export interface DiscountTargets {
  readonly kind: TargetScope;
  readonly refs: readonly string[];
}

export interface DiscountBuys {
  readonly kind: "quantity" | "amount";
  /** Items, or minor units for `amount`. */
  readonly value: number;
  readonly scope: TargetScope;
  readonly refs: readonly string[];
}

export type GetsEffect =
  { readonly kind: "percentage"; readonly value: number } | { readonly kind: "free" };

export interface DiscountGets {
  readonly quantity: number;
  readonly scope: TargetScope;
  readonly refs: readonly string[];
  readonly effect: GetsEffect;
}

export type MinimumRequirement =
  | { readonly kind: "none" }
  | { readonly kind: "amount"; readonly amountMinor: number }
  | { readonly kind: "quantity"; readonly quantity: number };

export type CustomerEligibility =
  | { readonly kind: "all" }
  | { readonly kind: "customers"; readonly customerRefs: readonly string[] };

export interface CombinesWith {
  readonly product: boolean;
  readonly order: boolean;
  readonly shipping: boolean;
}

/** One discount as the API reads it back: the form's fields, the derived status, the usage. */
export interface DiscountDto {
  readonly id: string;
  readonly type: DiscountType;
  readonly method: DiscountMethod;
  readonly title: string;
  readonly code: string | null;
  readonly status: DiscountStatus;
  readonly value: DiscountValue | null;
  readonly appliesTo: DiscountTargets | null;
  readonly appliesOncePerOrder: boolean;
  readonly buys: DiscountBuys | null;
  readonly gets: DiscountGets | null;
  readonly maxUsesPerOrder: number | null;
  readonly countries: readonly string[] | null;
  readonly maxShippingRateMinor: number | null;
  readonly minimumRequirement: MinimumRequirement;
  readonly customerEligibility: CustomerEligibility;
  readonly usageLimit: number | null;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: CombinesWith;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly usageCount: number;
}

/** The body of `POST /discounts` and `PUT /discounts/:id` (`discountInputSchema`). */
export interface DiscountInput {
  readonly type: DiscountType;
  readonly method: DiscountMethod;
  readonly title?: string;
  readonly code?: string;
  readonly value?: DiscountValue;
  readonly appliesTo?: DiscountTargets;
  readonly appliesOncePerOrder?: boolean;
  readonly buys?: DiscountBuys;
  readonly gets?: DiscountGets;
  readonly maxUsesPerOrder?: number;
  readonly countries?: readonly string[];
  readonly maxShippingRateMinor?: number;
  readonly minimumRequirement: MinimumRequirement;
  readonly customerEligibility: CustomerEligibility;
  readonly usageLimit?: number;
  readonly oncePerCustomer: boolean;
  readonly combinesWith: CombinesWith;
  readonly startsAt: string;
  readonly endsAt?: string;
}

export interface DiscountsPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

/** Shopify's combination class of each type. */
export function discountClassOf(type: DiscountType): DiscountClass {
  if (type === "amount_off_order") return "order";
  if (type === "free_shipping") return "shipping";
  return "product";
}

export function isDiscountType(value: unknown): value is DiscountType {
  return typeof value === "string" && (DISCOUNT_TYPES as readonly string[]).includes(value);
}

export function isDiscountView(value: unknown): value is DiscountView {
  return typeof value === "string" && (DISCOUNT_VIEWS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Checks the fields every screen reads; the rest follow the API's contract. */
export function isDiscountDto(value: unknown): value is DiscountDto {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    isDiscountType(value["type"]) &&
    (value["method"] === "code" || value["method"] === "automatic") &&
    typeof value["title"] === "string" &&
    (value["status"] === "active" ||
      value["status"] === "scheduled" ||
      value["status"] === "expired") &&
    isRecord(value["minimumRequirement"]) &&
    isRecord(value["customerEligibility"]) &&
    isRecord(value["combinesWith"]) &&
    typeof value["startsAt"] === "string" &&
    typeof value["usageCount"] === "number"
  );
}

interface DiscountsPageDto {
  readonly items: readonly DiscountDto[];
  readonly pageInfo: DiscountsPageInfo;
}

function isDiscountsPageDto(value: unknown): value is DiscountsPageDto {
  return (
    isRecord(value) &&
    Array.isArray(value["items"]) &&
    value["items"].every(isDiscountDto) &&
    isRecord(value["pageInfo"])
  );
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

export type FetchDiscountsPageResult =
  | {
      readonly outcome: "ok";
      readonly items: readonly DiscountDto[];
      readonly pageInfo: DiscountsPageInfo;
    }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "error"; readonly message: string };

/** `GET /discounts` — one tab of the list, searched by title or code, cursor-paginated. */
export async function fetchDiscountsPage(query: {
  readonly view?: DiscountView;
  readonly q?: string;
  readonly first?: number;
  readonly after?: string;
}): Promise<FetchDiscountsPageResult> {
  const params = new URLSearchParams();
  if (query.view !== undefined && query.view !== "all") params.set("view", query.view);
  const q = query.q?.trim() ?? "";
  if (q !== "") params.set("q", q);
  if (query.first !== undefined) params.set("first", String(query.first));
  if (query.after !== undefined) params.set("after", query.after);

  const result = await getAdminApi(`/api/v1/discounts?${params.toString()}`, isDiscountsPageDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", items: result.data.items, pageInfo: result.data.pageInfo };
  }
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  return {
    outcome: "error",
    message: result.outcome === "not_found" ? "Not found" : result.message,
  };
}

export type FetchDiscountResult =
  | { readonly outcome: "ok"; readonly discount: DiscountDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

function discountPath(discountId: string, suffix = ""): string {
  return `/api/v1/discounts/${encodeURIComponent(discountId)}${suffix}`;
}

/** `GET /discounts/:discountId` — the form's shape. A deleted discount is `not_found`. */
export async function fetchDiscount(discountId: string): Promise<FetchDiscountResult> {
  const result = await getAdminApi(discountPath(discountId), isDiscountDto);
  if (result.outcome === "ok") return { outcome: "ok", discount: result.data };
  return result;
}

/** `POST /discounts` — creates the discount (and its code) and activates it. */
export function createDiscount(
  input: DiscountInput,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    "/api/v1/discounts",
    { method: "POST", body: input, idempotencyKey },
    isDiscountDto,
  );
}

/** `PUT /discounts/:discountId` — every field except the type and the method. */
export function updateDiscount(
  discountId: string,
  input: DiscountInput,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    discountPath(discountId),
    { method: "PUT", body: input, idempotencyKey },
    isDiscountDto,
  );
}

/** `DELETE /discounts/:discountId` — archives it; it leaves every list. */
export function deleteDiscount(
  discountId: string,
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(discountPath(discountId), { method: "DELETE", idempotencyKey }, isUnknown);
}

/** `POST /discounts/:discountId/activate` — resumes a deactivated discount. */
export function activateDiscount(
  discountId: string,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    discountPath(discountId, "/activate"),
    { method: "POST", idempotencyKey },
    isDiscountDto,
  );
}

/** `POST /discounts/:discountId/deactivate` — Shopify's Deactivate: it stops at once. */
export function deactivateDiscount(
  discountId: string,
  idempotencyKey: string,
): Promise<MutationResult<DiscountDto>> {
  return mutateAdminApi(
    discountPath(discountId, "/deactivate"),
    { method: "POST", idempotencyKey },
    isDiscountDto,
  );
}
