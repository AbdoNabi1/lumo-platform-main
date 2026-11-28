/**
 * The revenue an order reports to an ad platform (P2-D4): merchandise after discounts. Shipping is excluded.
 *
 * Tax needs no subtraction, in either mode, because of how checkout assembles a total
 * (`CheckoutTotals.assemble`): `total = subtotal + shipping - shippingDiscount - discount + (taxIncluded ? 0 : tax)`.
 * Tax added on top is never inside `subtotalMinor`, so `subtotal - discount` already excludes it; tax that is
 * included is inside the prices by definition, and a merchant who sells at tax-inclusive prices reports those
 * prices. Subtracting `taxMinor` when `taxIncluded` is false (as the plan text reads) would take the same tax off
 * twice and under-report every VAT-on-top order.
 */
export interface OrderValueTotals {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor?: number;
  readonly shippingMinor?: number;
  readonly taxIncluded?: boolean;
}

export function businessValueMinor(totals: OrderValueTotals): number {
  return Math.max(0, Math.round(totals.subtotalMinor - totals.discountMinor));
}
