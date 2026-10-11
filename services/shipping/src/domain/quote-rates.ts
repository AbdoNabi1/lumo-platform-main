import { REST_OF_WORLD, type RateCondition, type ShippingZone } from "./shipping-zone";

/** What the quote needs to know about one cart line. Resolved server-side from Catalog, never from the browser. */
export interface QuoteLine {
  readonly unitPriceMinor: number;
  readonly quantity: number;
  readonly requiresShipping: boolean;
  readonly weightGrams: number | null;
}

export interface QuoteAddress {
  readonly country: string;
  /** ISO 3166-2, for countries with province data. */
  readonly province?: string | undefined;
}

export interface QuotedRate {
  /** The shipping rate's id; the implicit rate for an order with nothing to ship is `"none"`. */
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly description: string | null;
}

export const NO_SHIPPING_RATE_ID = "none";

const NO_SHIPPING_REQUIRED: QuotedRate = {
  id: NO_SHIPPING_RATE_ID,
  name: "No shipping required",
  priceMinor: 0,
  description: null,
};

/** 3: the zone lists the address's province; 2: it holds the whole country; 1: rest of world; 0: no match. */
function matchLevel(zone: ShippingZone, address: QuoteAddress): 0 | 1 | 2 | 3 {
  let level: 0 | 1 | 2 | 3 = 0;
  for (const country of zone.countries) {
    if (country.code === REST_OF_WORLD) {
      level = Math.max(level, 1) as 1;
    } else if (country.code === address.country) {
      if (country.provinces === null) {
        level = Math.max(level, 2) as 2;
      } else if (address.province !== undefined && country.provinces.includes(address.province)) {
        level = 3;
      }
    }
  }
  return level;
}

function within(value: number, min: number | undefined, max: number | undefined): boolean {
  return (min === undefined || value >= min) && (max === undefined || value < max);
}

function applies(condition: RateCondition, subtotalMinor: number, weightGrams: number): boolean {
  switch (condition.type) {
    case "none":
      return true;
    case "orderPrice":
      return within(subtotalMinor, condition.minMinor, condition.maxMinor);
    case "weight":
      return within(weightGrams, condition.minGrams, condition.maxGrams);
  }
}

/**
 * Shopify's quoting rules, as a pure function:
 *  1. the zone that matches the address — one listing its province beats one holding the whole
 *     country, which beats rest of world;
 *  2. that zone's rates whose condition matches — the order price is the subtotal of the lines, the
 *     weight the sum of weight × quantity over the lines that require shipping (minimum inclusive,
 *     maximum exclusive);
 *  3. no matching zone or rate means no rates;
 *  4. no line requiring shipping means one implicit free rate, `"none"`.
 * Rates come back cheapest first, then in the zone's own order.
 */
export function quoteRates(
  zones: readonly ShippingZone[],
  address: QuoteAddress,
  lines: readonly QuoteLine[],
): readonly QuotedRate[] {
  if (!lines.some((line) => line.requiresShipping)) return [NO_SHIPPING_REQUIRED];

  let best: ShippingZone | undefined;
  let bestLevel = 0;
  for (const zone of zones) {
    const level = matchLevel(zone, address);
    if (level > bestLevel) {
      best = zone;
      bestLevel = level;
    }
  }
  if (best === undefined) return [];

  const subtotalMinor = lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  const weightGrams = lines
    .filter((line) => line.requiresShipping)
    .reduce((sum, line) => sum + (line.weightGrams ?? 0) * line.quantity, 0);

  return best.rates
    .filter((rate) => applies(rate.condition, subtotalMinor, weightGrams))
    .sort((a, b) => a.priceMinor - b.priceMinor || a.position - b.position)
    .map((rate) => ({
      id: rate.id.toString(),
      name: rate.name,
      priceMinor: rate.priceMinor,
      description: rate.description,
    }));
}
