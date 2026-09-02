import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchIncomeStatementResult } from "@/lib/api/finance";

/**
 * The dashboard payload's integrity — and, more importantly, its honesty. A section/KPI that
 * shows sample data must say so via its own `provenance`; the failure mode this guards against is
 * a future edit flipping a `provenance` to `"live"` without a real source behind it, or a page-wide
 * flag papering over the fact that only Revenue has a real source today.
 *
 * `fetchIncomeStatement` is mocked (not the network) — same pattern `data/recent-orders.test.ts`
 * uses for `fetchRecentOrders` — so this suite is deterministic and never depends on a real Admin
 * API being reachable.
 */

const fetchIncomeStatement = vi.fn<() => Promise<FetchIncomeStatementResult>>();
vi.mock("@/lib/api/finance", () => ({
  fetchIncomeStatement: () => fetchIncomeStatement(),
}));

const { getDashboardData, summarizePageProvenance, computeTrailingPeriod } =
  await import("./dashboard");

function moneyOk(amountMinor: number, currency = "USD"): FetchIncomeStatementResult {
  return {
    outcome: "ok",
    data: {
      revenue: { amountMinor, currency },
      cogs: { amountMinor: 0, currency },
      expenses: { amountMinor: 0, currency },
      netIncome: { amountMinor, currency },
    },
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("getDashboardData", () => {
  it("falls back to demo revenue when the Finance API is unreachable, and every other section stays demo", async () => {
    fetchIncomeStatement.mockResolvedValue({ outcome: "error", message: "network error" });

    const data = await getDashboardData();
    const revenue = data.kpis.kpis.find((kpi) => kpi.id === "revenue");
    expect(revenue?.provenance).toBe("demo");
    expect(data.sales.provenance).toBe("demo");
    expect(data.topProducts.provenance).toBe("demo");
    expect(data.channels.provenance).toBe("demo");
    expect(summarizePageProvenance(data)).toBe("demo");
  });

  it("marks Revenue live when Finance answers for both periods, while every other KPI/section stays demo (mixed)", async () => {
    fetchIncomeStatement.mockResolvedValueOnce(moneyOk(1_000_000)).mockResolvedValueOnce(moneyOk(800_000));

    const data = await getDashboardData();
    const revenue = data.kpis.kpis.find((kpi) => kpi.id === "revenue");
    expect(revenue?.provenance).toBe("live");
    expect(revenue?.kind).toBe("money");
    if (revenue?.kind === "money") {
      expect(revenue.value).toEqual({ amountMinor: 1_000_000, currency: "USD" });
    }
    expect(revenue?.delta).toBeCloseTo(0.25, 5);
    // No daily-granularity source exists for a live figure — an empty trend is the honest state,
    // never a fabricated shape (see `fetchRevenueKpi`'s doc comment in `data/dashboard.ts`).
    expect(revenue?.trend).toEqual([]);

    const others = data.kpis.kpis.filter((kpi) => kpi.id !== "revenue");
    expect(others.every((kpi) => kpi.provenance === "demo")).toBe(true);
    expect(data.sales.provenance).toBe("demo");
    expect(data.topProducts.provenance).toBe("demo");
    expect(data.channels.provenance).toBe("demo");
    expect(summarizePageProvenance(data)).toBe("mixed");
  });

  it("never claims live for a section it did not actually fetch", async () => {
    fetchIncomeStatement.mockResolvedValue({ outcome: "unauthorized" });

    const data = await getDashboardData();
    expect(summarizePageProvenance(data)).toBe("demo");
    for (const kpi of data.kpis.kpis) {
      expect(kpi.provenance).toBe("demo");
    }
  });

  it("supplies exactly the four dashboard KPIs, each with a trend when demo", async () => {
    fetchIncomeStatement.mockResolvedValue({ outcome: "error", message: "network error" });

    const data = await getDashboardData();
    expect(data.kpis.kpis.map((kpi) => kpi.id)).toEqual([
      "revenue",
      "orders",
      "averageOrderValue",
      "conversionRate",
    ]);
    for (const kpi of data.kpis.kpis) {
      expect(kpi.trend.length).toBeGreaterThanOrEqual(2);
      expect(kpi.trend.every((point) => point >= 0 && point <= 1)).toBe(true);
    }
  });

  it("keeps channel shares consistent with the channel revenues and the stated total", async () => {
    fetchIncomeStatement.mockResolvedValue({ outcome: "error", message: "network error" });
    const data = await getDashboardData();

    const shareSum = data.channels.channels.reduce((sum, channel) => sum + channel.share, 0);
    expect(shareSum).toBeCloseTo(1, 2);

    const revenueSum = data.channels.channels.reduce(
      (sum, channel) => sum + channel.revenue.amountMinor,
      0,
    );
    expect(revenueSum).toBe(data.channels.totalRevenue.amountMinor);
  });

  it("uses one currency throughout, so no figure is silently mixed-unit", async () => {
    fetchIncomeStatement.mockResolvedValue({ outcome: "error", message: "network error" });
    const data = await getDashboardData();
    const currencies = new Set<string>([
      data.channels.totalRevenue.currency,
      ...data.sales.points.map((point) => point.revenue.currency),
      ...data.topProducts.products.map((product) => product.revenue.currency),
      ...data.channels.channels.map((channel) => channel.revenue.currency),
    ]);
    expect([...currencies]).toEqual([data.currency]);
  });

  it("orders the sales series chronologically, spanning the same 7-day period as the header", async () => {
    fetchIncomeStatement.mockResolvedValue({ outcome: "error", message: "network error" });
    const data = await getDashboardData();
    const dates = data.sales.points.map((point) => Date.parse(point.date));
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    expect(data.sales.points[0]?.date).toBe(data.period.startIso);
    expect(data.sales.points.at(-1)?.date).toBe(data.period.endIso);
  });
});

describe("computeTrailingPeriod", () => {
  it("ends the day before 'now' and spans two consecutive 7-day windows", () => {
    const period = computeTrailingPeriod(new Date("2026-08-31T12:00:00.000Z"));
    expect(period.endIso).toBe("2026-08-30");
    expect(period.startIso).toBe("2026-08-24");
    expect(period.comparisonEndIso).toBe("2026-08-23");
    expect(period.comparisonStartIso).toBe("2026-08-17");
  });
});

describe("summarizePageProvenance", () => {
  it("reads 'live' only when every KPI and section is live", async () => {
    fetchIncomeStatement.mockResolvedValueOnce(moneyOk(1)).mockResolvedValueOnce(moneyOk(1));
    const data = await getDashboardData();
    // Today only Revenue can go live, so a real all-live payload can't be constructed from
    // `getDashboardData()` — assert the mixed case is reported honestly instead of assuming a
    // shape this task never claims to produce.
    expect(summarizePageProvenance(data)).toBe("mixed");
  });
});
