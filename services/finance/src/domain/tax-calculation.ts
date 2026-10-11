import type { TaxSettings } from "./tax-settings";

/** One cart line as the tax needs it. Resolved server-side from Catalog, never from the browser. */
export interface TaxableLine {
  readonly unitPriceMinor: number;
  readonly quantity: number;
  /** Catalog's `taxable`: false lines carry no tax. */
  readonly taxable: boolean;
}

export interface TaxDestination {
  readonly country: string;
  /** ISO 3166-2, for countries with province data. */
  readonly province?: string | undefined;
}

export interface TaxResult {
  readonly taxMinor: number;
  /** True when the tax is already inside the prices (not added to the total). */
  readonly included: boolean;
}

/** What the order gave away before tax: a share of it is taken off the taxable lines and off the shipping price. */
export interface TaxDiscounts {
  /** The order-level discount, shared across the taxable lines in proportion to their amounts. */
  readonly orderMinor?: number | undefined;
  /** A discount on the shipping price, taken off it before it is taxed. */
  readonly shippingMinor?: number | undefined;
}

/**
 * Shares `discountMinor` across `amounts` in proportion to each amount, in whole minor units that add
 * up exactly (largest remainder: what the floors leave over goes one unit at a time to the largest
 * fractions, the earlier line first on a tie). A discount is capped at what the amounts hold, and a
 * negative one counts as none, so no share is ever larger than its amount.
 */
export function allocateDiscount(amounts: readonly number[], discountMinor: number): number[] {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const discount = Math.min(Math.max(0, discountMinor), total);
  if (total === 0 || discount === 0) return amounts.map(() => 0);

  const shares = amounts.map((amount) => Math.floor((discount * amount) / total));
  const remainders = amounts.map((amount, index) => ({
    index,
    remainder: (discount * amount) % total,
  }));
  let left = discount - shares.reduce((sum, share) => sum + share, 0);
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of remainders) {
    if (left === 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    left -= 1;
  }
  return shares;
}

/** `amount × bp / divisor`, rounded half up, in whole numbers. */
function roundedShare(amountMinor: number, basisPoints: number, divisor: number): number {
  const numerator = amountMinor * basisPoints;
  return Math.floor((2 * numerator + divisor) / (2 * divisor));
}

/**
 * Shopify's tax, as a pure function. Per taxable line — and the shipping price when the shop charges tax
 * on shipping — at the destination's rate (a province rate replaces the country's):
 *  - prices include tax: `tax = round(amount × r / (1 + r))`, already inside the amount;
 *  - prices exclude tax: `tax = round(amount × r)`, added to the total.
 * Rounding is half up on minor units, line by line. A destination with no region has no tax.
 *
 * Tax is worked out AFTER discounts, like Shopify: the order discount is shared across the taxable
 * lines in proportion to their amounts ({@link allocateDiscount}; a line that is not taxable gets no
 * share), and the shipping price is taxed after its own discount.
 */
export function calculateTax(
  settings: TaxSettings,
  lines: readonly TaxableLine[],
  destination: TaxDestination,
  shippingMinor: number,
  discounts: TaxDiscounts = {},
): TaxResult {
  const included = settings.pricesIncludeTax;
  const region = settings.regionFor(destination.country);
  if (region === undefined) return { taxMinor: 0, included };

  const rate = region.rateFor(destination.province);
  const taxOf = (amountMinor: number): number =>
    included
      ? roundedShare(amountMinor, rate, 10_000 + rate)
      : roundedShare(amountMinor, rate, 10_000);

  const taxable = lines.filter((line) => line.taxable);
  const amounts = taxable.map((line) => line.unitPriceMinor * line.quantity);
  const shares = allocateDiscount(amounts, discounts.orderMinor ?? 0);

  let taxMinor = 0;
  amounts.forEach((amount, index) => {
    taxMinor += taxOf(amount - (shares[index] ?? 0));
  });
  const shippingAfterDiscount = Math.max(
    0,
    shippingMinor - Math.max(0, discounts.shippingMinor ?? 0),
  );
  if (settings.chargeTaxOnShipping && shippingAfterDiscount > 0) {
    taxMinor += taxOf(shippingAfterDiscount);
  }
  return { taxMinor, included };
}
