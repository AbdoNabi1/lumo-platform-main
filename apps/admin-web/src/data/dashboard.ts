/**
 * The dashboard's data contract.
 *
 * Every widget except Recent Orders reads from `DashboardData` and nothing else — no component
 * holds its own figures. Recent Orders is the first exception: it is real (`GET /orders`,
 * `@/data/recent-orders`) and fetched independently, in its own Suspense boundary with its own
 * loading/empty/error/unauthorized states, rather than folded into this blob.
 *
 * **Per-section provenance, not one page-wide flag.** Earlier this module returned a single
 * `provenance` field for the whole payload, which meant one demo section forced every other
 * section — including ones that could genuinely go live — to render as demo too (or, worse, all
 * four non-Recent-Orders sections shared one gate and none of them rendered at all unless the
 * whole page was "live"). Since only the Revenue KPI actually has a real data source today
 * (`GET /finance/income-statement`, wired below), a page-wide flag could never be accurate: it
 * would either have to lie that Orders/AOV/Conversion/Sales/Top Products/Channels are live, or
 * hide the one real figure the operator actually has. Each of `kpis`/`sales`/`topProducts`/
 * `channels` now carries its own `DataProvenance` (per-KPI for `kpis`, since Revenue and the other
 * three KPIs genuinely differ; per-section for the rest, since each of those three sections is a
 * single indivisible figure with no partially-live sub-parts). `summarizePageProvenance` folds
 * these into one "live" / "demo" / "mixed" reading for the page header's badge — a coarser signal
 * for the header only, never a replacement for the per-section/per-KPI truth the rest of the page
 * renders from.
 *
 * `provenance` must never say "live" for a figure that was not actually fetched from a real
 * backend this request. See `docs/plans/BLOCKERS.md`'s T5.13 entry for exactly which sections
 * still have no real data source in this codebase and why.
 */

import { fetchIncomeStatement } from "@/lib/api/finance";

export type DataProvenance = "live" | "demo";

/** Coarse page-level reading for `DashboardHeader`'s single badge — see the module doc above. */
export type PageProvenance = "live" | "demo" | "mixed";

/** Money is carried in minor units, matching the platform's `Money` kernel type. */
export interface MoneyAmount {
  readonly amountMinor: number;
  readonly currency: string;
}

export type KpiId = "revenue" | "orders" | "averageOrderValue" | "conversionRate";

export interface Kpi {
  readonly id: KpiId;
  /** Where this specific KPI's figures came from — independent of the other three KPIs. */
  readonly provenance: DataProvenance;
  /** Fraction change vs the comparison period (0.182 = +18.2%). */
  readonly delta: number;
  /**
   * Normalised 0–1 sparkline samples, oldest first. Empty when a live figure has no real
   * daily-granularity source to draw a trend from (see `fetchRevenueKpi` below) — `Sparkline`
   * already renders nothing for fewer than 2 points, so an empty trend is a correct "no trend
   * data" state, not a bug.
   */
  readonly trend: readonly number[];
}

export interface MoneyKpi extends Kpi {
  readonly kind: "money";
  readonly value: MoneyAmount;
}

export interface CountKpi extends Kpi {
  readonly kind: "count";
  readonly value: number;
}

export interface RateKpi extends Kpi {
  readonly kind: "rate";
  /** Fraction, not percentage points (0.0234 = 2.34%). */
  readonly value: number;
}

export type DashboardKpi = MoneyKpi | CountKpi | RateKpi;

export interface SalesPoint {
  readonly date: string;
  readonly revenue: MoneyAmount;
  readonly orders: number;
}

export type OrderStatus = "paid" | "processing" | "refunded";

export interface RecentOrder {
  readonly id: string;
  readonly reference: string;
  readonly customerName: string;
  readonly customerInitials: string;
  readonly minutesAgo: number;
  readonly status: OrderStatus;
  readonly total: MoneyAmount;
}

export type StockState =
  | { readonly kind: "in-stock" }
  | { readonly kind: "low"; readonly available: number }
  | { readonly kind: "out-of-stock" };

export interface TopProduct {
  readonly id: string;
  readonly name: string;
  readonly unitsSold: number;
  readonly revenue: MoneyAmount;
  readonly views: number;
  /** Fraction (0.0665 = 6.65%). */
  readonly conversion: number;
  readonly stock: StockState;
}

export type ChannelId = "onlineStore" | "mobileApp" | "marketplace" | "retailStore" | "other";

export interface ChannelShare {
  readonly id: ChannelId;
  readonly revenue: MoneyAmount;
  /** Fraction of total revenue (0.564 = 56.4%). */
  readonly share: number;
}

export interface DashboardPeriod {
  readonly startIso: string;
  readonly endIso: string;
  readonly comparisonStartIso: string;
  readonly comparisonEndIso: string;
}

/** The KPI row. No section-level `provenance` here — see the module doc: each KPI is its own. */
export interface KpisSection {
  readonly kpis: readonly DashboardKpi[];
}

/**
 * Sales overview (revenue + orders per day). Demo today — see `docs/plans/BLOCKERS.md`'s T5.13
 * entry: `GET /orders` has no date-range filter and no day-level aggregation, so there is no way
 * to build a real per-day series for a period.
 */
export interface SalesSection {
  readonly provenance: DataProvenance;
  readonly points: readonly SalesPoint[];
}

/**
 * Top products by sales. Demo today — see `docs/plans/BLOCKERS.md`'s T5.13 entry: the Catalog API
 * (`GET /products`) carries no `unitsSold`/`views`/`conversion`, and no sales-ranking endpoint
 * exists anywhere in this codebase (the same G-8 reporting-read-model gap Phase 4 documented).
 */
export interface TopProductsSection {
  readonly provenance: DataProvenance;
  readonly products: readonly TopProduct[];
}

/**
 * Revenue split by sales channel. Demo today — see `docs/plans/BLOCKERS.md`'s T5.13 entry: no
 * Orders or Finance DTO carries a channel dimension anywhere in this codebase.
 */
export interface ChannelsSection {
  readonly provenance: DataProvenance;
  readonly channels: readonly ChannelShare[];
  readonly totalRevenue: MoneyAmount;
}

/**
 * Recent orders are deliberately NOT part of this payload — they come from the real `GET /orders`
 * endpoint via `@/data/recent-orders`, rendered in their own Suspense boundary with their own
 * loading/empty/error/unauthorized states (`components/dashboard/recent-orders-section.tsx`).
 */
export interface DashboardData {
  readonly currency: string;
  readonly period: DashboardPeriod;
  readonly kpis: KpisSection;
  readonly sales: SalesSection;
  readonly topProducts: TopProductsSection;
  readonly channels: ChannelsSection;
}

/**
 * Folds every KPI's and section's own `provenance` into one page-level reading for
 * `DashboardHeader`'s single badge. "live" only when every KPI and section is live; "demo" only
 * when every one of them is demo; "mixed" otherwise (today's actual state: Revenue live, the rest
 * demo). This is a display convenience only — every component below the header still renders from
 * its own real per-section/per-KPI `provenance`, never from this summary.
 */
export function summarizePageProvenance(data: DashboardData): PageProvenance {
  const flags: readonly DataProvenance[] = [
    ...data.kpis.kpis.map((kpi) => kpi.provenance),
    data.sales.provenance,
    data.topProducts.provenance,
    data.channels.provenance,
  ];
  if (flags.every((flag) => flag === "live")) return "live";
  if (flags.every((flag) => flag === "demo")) return "demo";
  return "mixed";
}

const CURRENCY = "USD";
const usd = (amountMinor: number): MoneyAmount => ({ amountMinor, currency: CURRENCY });

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, delta: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoDate(date);
}

/**
 * The trailing 7-day window ending yesterday (today is always a partial day, so it's excluded),
 * plus the preceding 7-day window for the period-over-period comparison. Computed from the real
 * clock — not a hardcoded date — so the one live figure this page has (Revenue, below) is always
 * requested for a period the operator recognizes as "now."
 */
export function computeTrailingPeriod(now: Date = new Date()): DashboardPeriod {
  const endIso = addDays(isoDate(now), -1);
  const startIso = addDays(endIso, -6);
  const comparisonEndIso = addDays(startIso, -1);
  const comparisonStartIso = addDays(comparisonEndIso, -6);
  return { startIso, endIso, comparisonStartIso, comparisonEndIso };
}

/** Same relative shape as the original hand-picked demo week — only the dates move with the period. */
const SALES_SAMPLE: readonly { readonly revenueMinor: number; readonly orders: number }[] = [
  { revenueMinor: 4_150_000, orders: 231 },
  { revenueMinor: 5_890_000, orders: 342 },
  { revenueMinor: 3_820_000, orders: 268 },
  { revenueMinor: 4_523_000, orders: 520 },
  { revenueMinor: 2_940_000, orders: 297 },
  { revenueMinor: 6_210_000, orders: 445 },
  { revenueMinor: 5_140_000, orders: 611 },
];

function demoSalesFor(period: DashboardPeriod): readonly SalesPoint[] {
  return SALES_SAMPLE.map((sample, index) => ({
    date: addDays(period.startIso, index),
    revenue: usd(sample.revenueMinor),
    orders: sample.orders,
  }));
}

const DEMO_TOP_PRODUCTS: readonly TopProduct[] = [
  {
    id: "prd_chair_pro",
    name: "Lumo Chair Pro",
    unitsSold: 254,
    revenue: usd(2_540_000),
    views: 3_820,
    conversion: 0.0665,
    stock: { kind: "low", available: 8 },
  },
  {
    id: "prd_desk_lamp",
    name: "Lumo Desk Lamp",
    unitsSold: 198,
    revenue: usd(1_584_000),
    views: 2_940,
    conversion: 0.0518,
    stock: { kind: "in-stock" },
  },
  {
    id: "prd_shelf",
    name: "Lumo Shelf",
    unitsSold: 176,
    revenue: usd(1_408_000),
    views: 2_110,
    conversion: 0.0622,
    stock: { kind: "in-stock" },
  },
  {
    id: "prd_sofa",
    name: "Lumo Sofa 2-Seater",
    unitsSold: 142,
    revenue: usd(2_130_000),
    views: 1_890,
    conversion: 0.0751,
    stock: { kind: "low", available: 5 },
  },
  {
    id: "prd_coffee_table",
    name: "Lumo Coffee Table",
    unitsSold: 118,
    revenue: usd(944_000),
    views: 1_450,
    conversion: 0.049,
    stock: { kind: "out-of-stock" },
  },
];

const DEMO_CHANNELS: readonly ChannelShare[] = [
  { id: "onlineStore", revenue: usd(7_234_000), share: 0.564 },
  { id: "mobileApp", revenue: usd(2_852_000), share: 0.222 },
  { id: "marketplace", revenue: usd(1_785_000), share: 0.139 },
  { id: "retailStore", revenue: usd(643_000), share: 0.05 },
  { id: "other", revenue: usd(320_000), share: 0.025 },
];

const DEMO_TOTAL_CHANNEL_REVENUE = usd(12_834_000);

const DEMO_ORDERS_KPI: CountKpi = {
  id: "orders",
  kind: "count",
  provenance: "demo",
  value: 1_482,
  delta: 0.124,
  trend: [0.3, 0.45, 0.24, 0.6, 0.36, 0.55, 0.82],
};

const DEMO_AVERAGE_ORDER_VALUE_KPI: MoneyKpi = {
  id: "averageOrderValue",
  kind: "money",
  provenance: "demo",
  value: usd(8_664),
  delta: 0.086,
  trend: [0.4, 0.36, 0.5, 0.46, 0.58, 0.52, 0.74],
};

const DEMO_CONVERSION_RATE_KPI: RateKpi = {
  id: "conversionRate",
  kind: "rate",
  provenance: "demo",
  value: 0.0234,
  delta: 0.061,
  trend: [0.28, 0.4, 0.34, 0.5, 0.44, 0.62, 0.78],
};

const DEMO_REVENUE_KPI: MoneyKpi = {
  id: "revenue",
  kind: "money",
  provenance: "demo",
  value: usd(12_834_000),
  delta: 0.182,
  trend: [0.35, 0.52, 0.3, 0.42, 0.24, 0.68, 0.86],
};

/** Revenue ÷ comparison-revenue, guarding the one legitimate divide-by-zero case (a comparison
 *  period with zero revenue) with a flat fallback rather than `Infinity`/`NaN` — never a fabricated
 *  bespoke number, just the two honest edges of "no prior revenue to compare against". */
function fractionalDelta(current: number, comparison: number): number {
  if (comparison === 0) return current === 0 ? 0 : 1;
  return (current - comparison) / Math.abs(comparison);
}

/**
 * The Revenue KPI, live: `GET /finance/income-statement`, called once for the current period and
 * once for the comparison period (in parallel), per `lib/api/finance.ts`'s `fetchIncomeStatement`
 * (already wired in T3.2). `trend` is deliberately empty — Finance has no daily-granularity
 * endpoint, and building one from 7+ separate income-statement calls per page load was judged not
 * worth the request fan-out for a sparkline; `Sparkline` already renders nothing for an empty
 * array, so this is an honest "no trend" state, not a fabricated flat line.
 *
 * Falls back to the demo figure (still labelled `provenance: "demo"`) on any non-`"ok"` outcome —
 * unauthorized, network error, or an unexpected response shape all degrade to demo rather than
 * breaking the KPI row or leaving it in a loading state forever. The demo fallback is always
 * truthfully labelled, so this can never present a stale/fake number as live.
 */
async function fetchRevenueKpi(period: DashboardPeriod, currency: string): Promise<MoneyKpi> {
  const [current, comparison] = await Promise.all([
    fetchIncomeStatement(period.startIso, period.endIso, currency),
    fetchIncomeStatement(period.comparisonStartIso, period.comparisonEndIso, currency),
  ]);

  if (current.outcome !== "ok" || comparison.outcome !== "ok") {
    return DEMO_REVENUE_KPI;
  }

  return {
    id: "revenue",
    kind: "money",
    provenance: "live",
    value: current.data.revenue,
    delta: fractionalDelta(current.data.revenue.amountMinor, comparison.data.revenue.amountMinor),
    trend: [],
  };
}

/**
 * Resolve the dashboard payload.
 *
 * Every section/KPI resolves independently and truthfully labels its own `provenance` — see the
 * module doc comment for why this is per-section rather than one page-wide flag, and
 * `docs/plans/BLOCKERS.md`'s T5.13 entry for exactly which sections have no real data source yet.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const period = computeTrailingPeriod();
  const revenueKpi = await fetchRevenueKpi(period, CURRENCY);

  return {
    currency: CURRENCY,
    period,
    kpis: {
      kpis: [revenueKpi, DEMO_ORDERS_KPI, DEMO_AVERAGE_ORDER_VALUE_KPI, DEMO_CONVERSION_RATE_KPI],
    },
    sales: { provenance: "demo", points: demoSalesFor(period) },
    topProducts: { provenance: "demo", products: DEMO_TOP_PRODUCTS },
    channels: {
      provenance: "demo",
      channels: DEMO_CHANNELS,
      totalRevenue: DEMO_TOTAL_CHANNEL_REVENUE,
    },
  };
}
