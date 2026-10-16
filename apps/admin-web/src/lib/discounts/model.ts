/**
 * Phase 2 Part 2 — the discount model shared by the server (`lib/api/discounts.ts`) and the browser
 * (the discount form, the list). Pure types and helpers only: this module imports nothing, so a
 * client component can import its values without pulling server-only code (`next/headers`) into
 * the browser bundle. The types mirror `apps/admin/src/interfaces/discounts/discount-dto.ts` and
 * `discount-input.ts`.
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
