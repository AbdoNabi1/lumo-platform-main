import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DashboardHeader } from "./dashboard-header";
import { KpiCard } from "./kpi-card";
import { RecentOrders } from "./recent-orders";
import { SalesByChannel } from "./sales-by-channel";
import { SalesOverview } from "./sales-overview";
import { TopProducts } from "./top-products";
import type { DashboardData } from "@/data/dashboard";
import type { FetchIncomeStatementResult } from "@/lib/api/finance";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";

/**
 * Dashboard widgets, tested for the three things a redesign can quietly break: that they render
 * whatever the data source gives them (rather than baking figures in), that the accessible reading
 * of each widget is complete without relying on colour or shape, and that a still-demo section
 * always says so (never silently, never for the whole page when only part of it is demo).
 */

const fetchIncomeStatement = vi.fn<() => Promise<FetchIncomeStatementResult>>();
vi.mock("@/lib/api/finance", () => ({
  fetchIncomeStatement: () => fetchIncomeStatement(),
}));

const { getDashboardData } = await import("@/data/dashboard");

afterEach(() => {
  vi.resetAllMocks();
});

async function loadDemo(): Promise<DashboardData> {
  fetchIncomeStatement.mockResolvedValue({ outcome: "error", message: "no backend in tests" });
  return getDashboardData();
}

describe("DashboardHeader", () => {
  it("names the page once, at level 1", () => {
    render(
      <DashboardHeader t={en} userName="Abdullah" rangeLabel="May 12 – 18" provenance="live" />,
    );
    expect(screen.getByRole("heading", { level: 1, name: en.header.title })).toBeInTheDocument();
  });

  it("labels a fully-demo page as demo", () => {
    render(
      <DashboardHeader t={en} userName="Abdullah" rangeLabel="May 12 – 18" provenance="demo" />,
    );
    expect(screen.getByText(en.data.demoBadge)).toBeInTheDocument();
  });

  it("labels a partly-live page as partial, not fully demo and not fully live", () => {
    render(
      <DashboardHeader t={en} userName="Abdullah" rangeLabel="May 12 – 18" provenance="mixed" />,
    );
    expect(screen.getByText(en.data.partialBadge)).toBeInTheDocument();
    expect(screen.queryByText(en.data.demoBadge)).not.toBeInTheDocument();
  });

  it("does not claim demo or partial data when every figure is live", () => {
    render(
      <DashboardHeader t={en} userName="Abdullah" rangeLabel="May 12 – 18" provenance="live" />,
    );
    expect(screen.queryByText(en.data.demoBadge)).not.toBeInTheDocument();
    expect(screen.queryByText(en.data.partialBadge)).not.toBeInTheDocument();
  });
});

describe("KpiCard", () => {
  it("renders the value supplied by the data source, formatted for the locale", async () => {
    const dashboard = await loadDemo();
    const revenue = dashboard.kpis.kpis.find((kpi) => kpi.id === "revenue");
    expect(revenue).toBeDefined();
    if (revenue === undefined) return;

    render(<KpiCard kpi={revenue} t={en} locale="en" comparisonLabel="May 5 – 11" />);
    expect(screen.getByRole("heading", { name: en.kpi.totalRevenue })).toBeInTheDocument();
    expect(screen.getByText("$128,340.00")).toBeInTheDocument();
  });

  it("states the delta's direction in text, not only in colour", async () => {
    const dashboard = await loadDemo();
    const revenue = dashboard.kpis.kpis.find((kpi) => kpi.id === "revenue");
    if (revenue === undefined) throw new Error("revenue KPI missing");

    render(<KpiCard kpi={revenue} t={en} locale="en" comparisonLabel="May 5 – 11" />);
    expect(screen.getByText("+18.2%")).toBeInTheDocument();
  });

  it("formats the same KPI differently under Arabic", async () => {
    const dashboard = await loadDemo();
    const revenue = dashboard.kpis.kpis.find((kpi) => kpi.id === "revenue");
    if (revenue === undefined) throw new Error("revenue KPI missing");

    render(<KpiCard kpi={revenue} t={ar} locale="ar" comparisonLabel="٥ – ١١ مايو" />);
    expect(screen.getByRole("heading", { name: ar.kpi.totalRevenue })).toBeInTheDocument();
    expect(screen.queryByText("$128,340.00")).not.toBeInTheDocument();
  });

  it("tags a demo KPI as demo, never as live", async () => {
    const dashboard = await loadDemo();
    const orders = dashboard.kpis.kpis.find((kpi) => kpi.id === "orders");
    if (orders === undefined) throw new Error("orders KPI missing");

    render(<KpiCard kpi={orders} t={en} locale="en" comparisonLabel="May 5 – 11" />);
    expect(screen.getByText(en.data.demoTag)).toBeInTheDocument();
    expect(screen.queryByText(en.data.liveTag)).not.toBeInTheDocument();
  });

  it("tags a live KPI as live, never as demo", async () => {
    fetchIncomeStatement
      .mockResolvedValueOnce({
        outcome: "ok",
        data: {
          revenue: { amountMinor: 1_000_000, currency: "USD" },
          cogs: { amountMinor: 0, currency: "USD" },
          expenses: { amountMinor: 0, currency: "USD" },
          netIncome: { amountMinor: 1_000_000, currency: "USD" },
        },
      })
      .mockResolvedValueOnce({
        outcome: "ok",
        data: {
          revenue: { amountMinor: 800_000, currency: "USD" },
          cogs: { amountMinor: 0, currency: "USD" },
          expenses: { amountMinor: 0, currency: "USD" },
          netIncome: { amountMinor: 800_000, currency: "USD" },
        },
      });
    const dashboard = await getDashboardData();
    const revenue = dashboard.kpis.kpis.find((kpi) => kpi.id === "revenue");
    if (revenue === undefined) throw new Error("revenue KPI missing");
    expect(revenue.provenance).toBe("live");

    render(<KpiCard kpi={revenue} t={en} locale="en" comparisonLabel="May 5 – 11" />);
    expect(screen.getByText(en.data.liveTag)).toBeInTheDocument();
    expect(screen.queryByText(en.data.demoTag)).not.toBeInTheDocument();
  });
});

describe("SalesOverview", () => {
  it("exposes the chart as a labelled image", async () => {
    const dashboard = await loadDemo();
    render(
      <SalesOverview
        points={dashboard.sales.points}
        provenance={dashboard.sales.provenance}
        t={en}
        locale="en"
        currency={dashboard.currency}
      />,
    );
    expect(screen.getByRole("img", { name: en.sales.chartLabel })).toBeInTheDocument();
  });

  it("also states every plotted point in words, so the chart is readable without sight", async () => {
    const dashboard = await loadDemo();
    const { container } = render(
      <SalesOverview
        points={dashboard.sales.points}
        provenance={dashboard.sales.provenance}
        t={en}
        locale="en"
        currency={dashboard.currency}
      />,
    );
    const readings = container.querySelectorAll("ul.sr-only li");
    expect(readings.length).toBe(dashboard.sales.points.length);
  });

  it("says why it's still demo, scoped to this card rather than the whole page", async () => {
    const dashboard = await loadDemo();
    render(
      <SalesOverview
        points={dashboard.sales.points}
        provenance="demo"
        t={en}
        locale="en"
        currency={dashboard.currency}
      />,
    );
    expect(screen.getByText(en.sales.demoExplanation)).toBeInTheDocument();
  });

  it("shows no demo notice when the section is live", async () => {
    const dashboard = await loadDemo();
    render(
      <SalesOverview
        points={dashboard.sales.points}
        provenance="live"
        t={en}
        locale="en"
        currency={dashboard.currency}
      />,
    );
    expect(screen.queryByText(en.sales.demoExplanation)).not.toBeInTheDocument();
  });
});

describe("RecentOrders", () => {
  // Fixture data, not `dashboard.recentOrders` — Recent Orders is sourced from the real `GET
  // /orders` endpoint now (`@/data/recent-orders`), not the demo `DashboardData` blob this
  // component's own tests otherwise pull from. The component itself is unchanged: still a pure
  // presentational list of `RecentOrder`s.
  const orders = [
    {
      id: "order-1",
      reference: "#ORD-1",
      customerName: "Customer AB12CD",
      customerInitials: "AB",
      minutesAgo: 2,
      status: "paid" as const,
      total: { amountMinor: 1_290_0, currency: "USD" },
    },
    {
      id: "order-2",
      reference: "#ORD-2",
      customerName: "Customer EF34GH",
      customerInitials: "EF",
      minutesAgo: 120,
      status: "refunded" as const,
      total: { amountMinor: 5_900, currency: "USD" },
    },
  ];

  it("lists every order with its reference and status", () => {
    render(<RecentOrders orders={orders} t={en} locale="en" />);

    for (const order of orders) {
      expect(screen.getByText(order.reference)).toBeInTheDocument();
    }
    expect(screen.getAllByText(en.recentOrders.paid).length).toBeGreaterThan(0);
    expect(screen.getByText(en.recentOrders.refunded)).toBeInTheDocument();
  });

  it("shows a live indicator only when explicitly marked live", () => {
    render(<RecentOrders orders={orders} t={en} locale="en" live />);
    expect(screen.getByText(en.recentOrders.liveBadge)).toBeInTheDocument();
  });
});

describe("TopProducts", () => {
  it("renders a real table with a labelled scroll region and row headers", async () => {
    const dashboard = await loadDemo();
    render(
      <TopProducts
        products={dashboard.topProducts.products}
        provenance={dashboard.topProducts.provenance}
        t={en}
        locale="en"
      />,
    );

    const region = screen.getByRole("region", { name: en.topProducts.tableLabel });
    expect(region).toHaveAttribute("tabindex", "0");

    const table = within(region).getByRole("table");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(
      dashboard.topProducts.products.length,
    );
  });

  it("states stock level as text rather than colour alone", async () => {
    const dashboard = await loadDemo();
    render(
      <TopProducts
        products={dashboard.topProducts.products}
        provenance={dashboard.topProducts.provenance}
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText(en.topProducts.outOfStock)).toBeInTheDocument();
    expect(screen.getAllByText(en.topProducts.inStock).length).toBeGreaterThan(0);
  });

  it("says why it's still demo, scoped to this card", async () => {
    const dashboard = await loadDemo();
    render(
      <TopProducts
        products={dashboard.topProducts.products}
        provenance="demo"
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText(en.topProducts.demoExplanation)).toBeInTheDocument();
  });
});

describe("SalesByChannel", () => {
  it("repeats every slice of the donut in a text legend", async () => {
    const dashboard = await loadDemo();
    render(
      <SalesByChannel
        channels={dashboard.channels.channels}
        total={dashboard.channels.totalRevenue}
        provenance={dashboard.channels.provenance}
        t={en}
        locale="en"
      />,
    );

    for (const label of [
      en.channels.onlineStore,
      en.channels.mobileApp,
      en.channels.marketplace,
      en.channels.retailStore,
      en.channels.other,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("hides the decorative donut from assistive technology", async () => {
    const dashboard = await loadDemo();
    const { container } = render(
      <SalesByChannel
        channels={dashboard.channels.channels}
        total={dashboard.channels.totalRevenue}
        provenance={dashboard.channels.provenance}
        t={en}
        locale="en"
      />,
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("says why it's still demo, scoped to this card", async () => {
    const dashboard = await loadDemo();
    render(
      <SalesByChannel
        channels={dashboard.channels.channels}
        total={dashboard.channels.totalRevenue}
        provenance="demo"
        t={en}
        locale="en"
      />,
    );
    expect(screen.getByText(en.channels.demoExplanation)).toBeInTheDocument();
  });
});
