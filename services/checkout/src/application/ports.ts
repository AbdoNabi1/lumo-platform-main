import type { CheckoutAddress } from "../domain/value-objects/checkout-address";
import type { CheckoutItem } from "../domain/value-objects/checkout-item";
import type { CheckoutTotals } from "../domain/value-objects/checkout-totals";

export interface PricingValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Requests price validation for the session's item snapshots — Checkout never prices anything itself. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface PricingValidationPort {
  validate(
    items: readonly CheckoutItem[],
    currency: string,
    tenantId: string,
  ): Promise<PricingValidationResult>;
}

export interface InventoryValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Requests stock-availability validation — Checkout never reserves/modifies stock itself. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface InventoryValidationPort {
  validate(items: readonly CheckoutItem[], tenantId: string): Promise<InventoryValidationResult>;
}

export interface TaxCalculationResult {
  readonly taxMinor: number;
}

/** Requests a tax calculation from Finance (ADR-0024) — Checkout stores the returned snapshot verbatim, never computes tax. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface TaxCalculationPort {
  calculate(
    items: readonly CheckoutItem[],
    shippingAddress: { readonly country: string },
    currency: string,
    tenantId: string,
  ): Promise<TaxCalculationResult>;
}

export interface ShippingQuote {
  readonly method: string;
  readonly rateAmountMinor: number;
}

/** Requests shipping rate quotes from Shipping — Checkout stores the chosen quote's snapshot verbatim, never computes rates. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface ShippingCalculationPort {
  quote(
    shippingAddress: { readonly country: string; readonly postalCode: string },
    currency: string,
    tenantId: string,
  ): Promise<readonly ShippingQuote[]>;
}

export interface PromotionValidationResult {
  readonly valid: boolean;
  readonly discountMinor: number;
  readonly reason?: string;
}

/**
 * Requests promotion/coupon validation — Checkout is reference-only, never computes/applies a
 * discount itself.
 *
 * Widened (Phase 3 Task 11, C-3) from `validate(promotionRef, currency)`: the only owning
 * capability that computes a real discount, Promotions' `EvaluatePromotions`, evaluates rules
 * against a cart snapshot (product/category refs, quantities, subtotal) — a bare promotion
 * reference and currency carry none of that. `items` and `customerRef` give an implementation
 * enough to build that snapshot; mirrors `PricingValidationPort`/`InventoryValidationPort`, which
 * already take `items` for the same reason.
 * ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter.
 */
export interface PromotionValidationPort {
  validate(
    items: readonly CheckoutItem[],
    customerRef: string | undefined,
    promotionRef: string | undefined,
    currency: string,
    tenantId: string,
  ): Promise<PromotionValidationResult>;
}

/**
 * C-2: the outbound seam Checkout uses to materialize an order from a completed session. Checkout
 * owns the session lifecycle, never the Order aggregate — this port is how the boundary is crossed
 * without Checkout importing @platform/orders.
 *
 * Shaped to match `CheckoutSession.generateOrderDraft()`'s `OrderDraft` (plus `idempotencyKey`)
 * rather than a flattened summary: Orders' `CreateOrderFromCheckout` needs `billingAddress` and the
 * full subtotal/tax/shipping/discount/total breakdown to build its `OrderTotalsSnapshot`, which a
 * single `totalAmountMinor` cannot reconstruct. `customerRef` is optional because `CheckoutSession`
 * supports guest checkout (`session.isGuest`) — the adapter implementing this port decides what to
 * do when it's undefined.
 */
export interface OrderCreationPort {
  create(input: {
    /** ADR-0014 (WP-10, T10.3): the request's tenant. */
    readonly tenantId: string;
    readonly checkoutSessionId: string;
    readonly customerRef: string | undefined;
    /**
     * A guest session's receipt address (WP-1, G-52). Only meaningful when `customerRef` is
     * undefined: the implementation resolves a customer from it. Never proof of identity.
     */
    readonly contactEmail?: string;
    readonly currency: string;
    readonly items: readonly CheckoutItem[];
    readonly billingAddress: CheckoutAddress;
    readonly shippingAddress: CheckoutAddress;
    readonly totals: CheckoutTotals;
    readonly idempotencyKey: string;
  }): Promise<{ readonly orderRef: string }>;
}
