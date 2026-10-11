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
 * Discounts are not part of the inputs: tax is worked out on list prices.
 */
export function calculateTax(
  settings: TaxSettings,
  lines: readonly TaxableLine[],
  destination: TaxDestination,
  shippingMinor: number,
): TaxResult {
  const included = settings.pricesIncludeTax;
  const region = settings.regionFor(destination.country);
  if (region === undefined) return { taxMinor: 0, included };

  const rate = region.rateFor(destination.province);
  const taxOf = (amountMinor: number): number =>
    included
      ? roundedShare(amountMinor, rate, 10_000 + rate)
      : roundedShare(amountMinor, rate, 10_000);

  let taxMinor = 0;
  for (const line of lines) {
    if (line.taxable) taxMinor += taxOf(line.unitPriceMinor * line.quantity);
  }
  if (settings.chargeTaxOnShipping && shippingMinor > 0) taxMinor += taxOf(shippingMinor);
  return { taxMinor, included };
}
