/**
 * Phase 2 (Shopify-style discounts): what Promotions decided for a session — stored verbatim and
 * never computed here, like the tax and shipping snapshots. Plain data so Checkout imports nothing
 * from Promotions.
 */
export type DiscountClassValue = "product" | "order" | "shipping";

export interface AppliedDiscountSnapshot {
  readonly promotionId: string;
  readonly couponId?: string;
  readonly code?: string;
  readonly title: string;
  readonly discountClass: DiscountClassValue;
  readonly amountMinor: number;
}

export interface DiscountCodeStatusSnapshot {
  readonly code: string;
  readonly applicable: boolean;
  /** Why a code gives nothing (`not_found`, `minimum_not_met`, …); the storefront words it. */
  readonly reason?: string;
}

export interface DiscountSnapshot {
  readonly applied: readonly AppliedDiscountSnapshot[];
  /** Product + order discounts — what `discountMinor` and the tax calculation use. */
  readonly orderDiscountMinor: number;
  readonly shippingDiscountMinor: number;
  readonly codeStatuses: readonly DiscountCodeStatusSnapshot[];
  readonly lineAllocations: readonly { readonly lineRef: string; readonly amountMinor: number }[];
}

export const MAX_DISCOUNT_CODES = 5;
export const DISCOUNT_ATTEMPT_LIMIT = 10;
export const DISCOUNT_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** Trimmed and upper case — the same rule Coupons stores codes with. */
export function normalizeDiscountCode(code: string): string {
  return code.trim().toUpperCase();
}
