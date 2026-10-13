/**
 * The sales read model's contract (Plan 3D). Every figure the dashboard shows comes from here, over
 * the shop's orders, and nothing else.
 *
 * - **Counted orders** are those created in the range, in the shop's currency, and never cancelled.
 * - A **fully refunded** order is still counted as an order but adds 0 to the sales (Shopify's "total
 *   sales" net of returns, simplified to full refunds; partial refunds are G-132).
 * - Days are the SHOP's calendar days: `from` and `to` are dates in the shop's time zone, `to` is
 *   EXCLUSIVE, and every day of the range appears in `daily`, zero days included.
 */

/** Largest range the read model answers, in days. */
export const MAX_SALES_RANGE_DAYS = 366;

/** How many products the "top products" list keeps. */
export const TOP_PRODUCTS_LIMIT = 5;

export interface SalesSummaryInput {
  readonly tenantId: string;
  /** First day, `YYYY-MM-DD` in `timezone`. */
  readonly from: string;
  /** Day AFTER the last day, `YYYY-MM-DD` in `timezone` (exclusive). */
  readonly to: string;
  /** IANA zone of the shop, e.g. `Africa/Cairo`. */
  readonly timezone: string;
  /** The shop's currency; orders in any other currency are not summed. */
  readonly currency: string;
  /** Also list the shop's open orders (all-time). Off for the comparison range, which has no use for them. */
  readonly includeOpenOrderIds?: boolean;
}

export interface DailySales {
  readonly date: string;
  readonly salesMinor: number;
  readonly orders: number;
}

export interface TopProduct {
  readonly productRef: string;
  readonly variantRef: string | null;
  readonly name: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly salesMinor: number;
}

export interface SalesSummary {
  readonly totalSalesMinor: number;
  readonly ordersCount: number;
  readonly averageOrderValueMinor: number;
  readonly daily: readonly DailySales[];
  readonly topProducts: readonly TopProduct[];
  /** Orders in the range in a currency other than `currency`: left out of every sum above. */
  readonly otherCurrencyOrders: number;
  /**
   * Ids of the orders that are not cancelled and not closed, ALL-TIME (not range-bound). Whether each
   * still has to be fulfilled is Fulfillment's fact, derived by the caller with the Plan 3B function
   * (`deriveFulfillmentStatus`), so Orders does not define it a second time. Empty unless asked for.
   */
  readonly openOrderIds: readonly string[];
}

export interface SalesSummaryQuery {
  summarize(input: SalesSummaryInput): Promise<SalesSummary>;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseUtcDay(value: string): number | null {
  if (!DATE_PATTERN.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(time)) return null;
  // `Date.parse` rolls an impossible date (2026-02-30) over; only an exact round trip is a real day.
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/** `null` when the range is usable, else why not. Shared by the use case and the HTTP route. */
export function validateSalesRange(from: string, to: string): string | null {
  const start = parseUtcDay(from);
  const end = parseUtcDay(to);
  if (start === null) return '"from" must be a date as YYYY-MM-DD';
  if (end === null) return '"to" must be a date as YYYY-MM-DD';
  if (start >= end) return '"from" must be before "to"';
  if ((end - start) / DAY_MS > MAX_SALES_RANGE_DAYS) {
    return `The range may not be longer than ${MAX_SALES_RANGE_DAYS} days`;
  }
  return null;
}

/** Every `YYYY-MM-DD` from `from` up to but not including `to`. */
export function enumerateDays(from: string, to: string): readonly string[] {
  const start = parseUtcDay(from);
  const end = parseUtcDay(to);
  if (start === null || end === null) return [];
  const days: string[] = [];
  for (let time = start; time < end; time += DAY_MS) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

/** The presets the dashboard's date picker offers; each is resolved against "today" in the shop's zone. */
export const SALES_RANGE_PRESETS = ["today", "yesterday", "7d", "30d", "month"] as const;
export type SalesRangePreset = (typeof SALES_RANGE_PRESETS)[number];

export function isSalesRangePreset(value: string): value is SalesRangePreset {
  return (SALES_RANGE_PRESETS as readonly string[]).includes(value);
}

/** The shop-local calendar day (`YYYY-MM-DD`) of an instant in an IANA zone. */
export function localDay(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function shiftDay(day: string, days: number): string {
  const start = parseUtcDay(day);
  if (start === null) return day;
  return new Date(start + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The `[from, to)` a preset stands for, given today's date in the shop's zone. Every preset ENDS
 * TODAY (`to` is tomorrow, exclusive): today; yesterday; the 7 and 30 days up to and including
 * today; the 1st of this month through today.
 */
export function resolveSalesRange(
  preset: SalesRangePreset,
  today: string,
): { readonly from: string; readonly to: string } {
  const tomorrow = shiftDay(today, 1);
  switch (preset) {
    case "today":
      return { from: today, to: tomorrow };
    case "yesterday":
      return { from: shiftDay(today, -1), to: today };
    case "7d":
      return { from: shiftDay(today, -6), to: tomorrow };
    case "30d":
      return { from: shiftDay(today, -29), to: tomorrow };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: tomorrow };
  }
}

/** The range of the same length that ends where this one starts (what a figure is compared with). */
export function previousSalesRange(
  from: string,
  to: string,
): { readonly from: string; readonly to: string } {
  const start = parseUtcDay(from);
  const end = parseUtcDay(to);
  if (start === null || end === null) return { from, to };
  return {
    from: new Date(start - (end - start)).toISOString().slice(0, 10),
    to: from,
  };
}

/** Sales over orders, rounded half up; 0 with no orders. */
export function averageOrderValueMinor(totalSalesMinor: number, ordersCount: number): number {
  if (ordersCount === 0) return 0;
  return Math.floor((totalSalesMinor * 2 + ordersCount) / (ordersCount * 2));
}

/** Quantity desc, then sales desc, then name; the first {@link TOP_PRODUCTS_LIMIT}. */
export function rankTopProducts(rows: readonly TopProduct[]): readonly TopProduct[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        b.salesMinor - a.salesMinor ||
        a.name.localeCompare(b.name) ||
        a.productRef.localeCompare(b.productRef) ||
        (a.variantRef ?? "").localeCompare(b.variantRef ?? ""),
    )
    .slice(0, TOP_PRODUCTS_LIMIT);
}

/** Per-day figures the implementations measure; the shared assembly fills the zero days and the totals. */
export interface MeasuredDay {
  readonly date: string;
  readonly salesMinor: number;
  readonly orders: number;
}

export function assembleSalesSummary(parts: {
  readonly from: string;
  readonly to: string;
  readonly measuredDays: readonly MeasuredDay[];
  readonly topProducts: readonly TopProduct[];
  readonly otherCurrencyOrders: number;
  readonly openOrderIds: readonly string[];
}): SalesSummary {
  const byDate = new Map(parts.measuredDays.map((day) => [day.date, day]));
  const daily = enumerateDays(parts.from, parts.to).map((date): DailySales => ({
    date,
    salesMinor: byDate.get(date)?.salesMinor ?? 0,
    orders: byDate.get(date)?.orders ?? 0,
  }));
  const totalSalesMinor = daily.reduce((sum, day) => sum + day.salesMinor, 0);
  const ordersCount = daily.reduce((sum, day) => sum + day.orders, 0);
  return {
    totalSalesMinor,
    ordersCount,
    averageOrderValueMinor: averageOrderValueMinor(totalSalesMinor, ordersCount),
    daily,
    topProducts: rankTopProducts(parts.topProducts),
    otherCurrencyOrders: parts.otherCurrencyOrders,
    openOrderIds: parts.openOrderIds,
  };
}
