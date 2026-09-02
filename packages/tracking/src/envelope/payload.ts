/**
 * Business payload (doc 16 §7). Every field is optional — a `page_viewed` carries almost none of
 * it and a `purchase` carries most. Monetary amounts are minor units (integer cents) to match the
 * platform-wide money convention; converting to vendor-expected decimals is a destination mapping
 * concern, not a capture concern.
 */

export interface LineItem {
  readonly itemId: string;
  readonly sku?: string;
  readonly name?: string;
  readonly category?: string;
  readonly brand?: string;
  readonly variant?: string;
  readonly quantity?: number;
  readonly priceMinor?: number;
  readonly discountMinor?: number;
  readonly position?: number;
}

export interface EventPayload {
  // Monetary
  readonly valueMinor?: number;
  readonly currency?: string;
  readonly taxMinor?: number;
  readonly shippingMinor?: number;
  readonly discountMinor?: number;
  readonly coupon?: string;

  // Contents
  readonly numItems?: number;
  readonly contentIds?: readonly string[];
  readonly contents?: readonly LineItem[];
  readonly contentType?: string;
  readonly itemList?: string;
  readonly products?: readonly LineItem[];
  readonly categories?: readonly string[];
  readonly searchString?: string;

  // Commerce references (bare ids — no cross-context joins, D-002)
  readonly transactionId?: string;
  readonly orderId?: string;
  readonly cartId?: string;
  readonly checkoutId?: string;
  readonly subscriptionId?: string;
  readonly refundId?: string;
  readonly promotionId?: string;

  // Method selection
  readonly paymentMethod?: string;
  readonly shippingMethod?: string;

  /** Point-in-time stock context, when the emitting surface has it. */
  readonly inventorySnapshot?: Readonly<Record<string, number>>;

  /** Merchant-defined additions, validated against the event definition's schema. */
  readonly customProperties?: Readonly<Record<string, unknown>>;
}

/** ISO-4217 shape check. Value/currency coherence is enforced by the validation stage. */
export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

/** Derives `numItems` from line items when the emitter did not supply it. */
export function deriveNumItems(items: readonly LineItem[] | undefined): number | undefined {
  if (items === undefined || items.length === 0) return undefined;
  return items.reduce((total, item) => total + (item.quantity ?? 1), 0);
}
