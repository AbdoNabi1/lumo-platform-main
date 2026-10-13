import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DashboardError } from "./dashboard-error";
import { DashboardHeader } from "./dashboard-header";
import { HomeKpis } from "./home-kpis";
import { SalesChart } from "./sales-chart";
import { TopProducts } from "./top-products";
import { emptyReport, salesReport } from "./test-fixtures";
import { dictionaryFor } from "@/lib/i18n";
import { en, type Dictionary } from "@/messages/en";

/** The Arabic dictionary, typed as the widened `Dictionary` the components take. */
const ar: Dictionary = dictionaryFor("ar");

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  refresh.mockReset();
});

describe("DashboardHeader", () => {
  it("names the page once, at level 1, as Home", () => {
    render(<DashboardHeader t={en} userName="Abdullah" range="7d" />);

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("offers the five date ranges, each one a link that puts the range in the URL", () => {
    render(<DashboardHeader t={en} userName="Abdullah" range="7d" />);

    const picker = screen.getByRole("navigation", { name: en.header.dateRange });
    const links = within(picker).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Today",
      "Yesterday",
      "Last 7 days",
      "Last 30 days",
      "This month",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/?range=today",
      "/?range=yesterday",
      "/?range=7d",
      "/?range=30d",
      "/?range=month",
    ]);
  });

  it("marks the chosen range, and only that one", () => {
    render(<DashboardHeader t={en} userName="Abdullah" range="30d" />);

    const current = screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"));
    expect(current.map((link) => link.textContent)).toEqual(["Last 30 days"]);
  });

  it("has no Filters button and no demo badge", () => {
    render(<DashboardHeader t={en} userName="Abdullah" range="7d" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/filters|demo|sample|unavailable/i);
  });

  it("speaks Arabic", () => {
    render(<DashboardHeader t={ar} userName="عبد الله" range="today" />);

    expect(screen.getByRole("heading", { level: 1, name: "الرئيسية" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "النهارده" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "الشهر ده" })).toBeInTheDocument();
  });
});

describe("HomeKpis", () => {
  const renderKpis = (
    data = salesReport(),
    dictionary: Dictionary = en,
    locale: "en" | "ar" = "en",
  ) =>
    render(
      <HomeKpis data={data} t={dictionary} locale={locale} comparisonLabel="Sep 29 – Oct 5" />,
    );

  it("shows the four cards, in order", () => {
    renderKpis();

    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Total sales", "Orders", "Average order value", "Orders to fulfill"]);
  });

  it("shows the real figures in the shop's currency", () => {
    renderKpis();

    expect(screen.getByText("EGP 500.00")).toBeInTheDocument(); // total sales
    expect(screen.getByText("8")).toBeInTheDocument(); // orders
    expect(screen.getByText("EGP 62.50")).toBeInTheDocument(); // average order value
    expect(screen.getByText("4")).toBeInTheDocument(); // orders to fulfill
  });

  it("shows zeros as zeros, never a placeholder number", () => {
    renderKpis(emptyReport());

    expect(screen.getAllByText("0")).toHaveLength(2); // orders, orders to fulfill
    expect(screen.getAllByText("EGP 0.00")).toHaveLength(2); // total sales, average order value
    expect(document.body.textContent).not.toMatch(/128|1,482|2\.34/);
  });

  it("says how each figure moved against the period before it", () => {
    renderKpis();

    expect(screen.getByText("+66.7%")).toBeInTheDocument(); // sales 500 vs 300
    expect(screen.getByText("+166.7%")).toBeInTheDocument(); // orders 8 vs 3
    expect(screen.getByText(/37\.5%/)).toBeInTheDocument(); // AOV 62.50 vs 100, down
    expect(screen.getAllByText("vs Sep 29 – Oct 5")).toHaveLength(3);
  });

  it("says New when the period before had nothing", () => {
    const data = salesReport();
    renderKpis({ ...data, previous: emptyReport().previous });

    expect(screen.getAllByText("New")).toHaveLength(3);
  });

  it("shows a dash, not a percentage, when both periods are empty", () => {
    renderKpis(emptyReport());

    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("draws a sparkline from the days of the range on the first three cards, not the fourth", () => {
    const { container } = renderKpis();

    const cards = Array.from(container.querySelectorAll("[data-kpi]"));
    expect(cards.map((card) => card.getAttribute("data-kpi"))).toEqual([
      "totalSales",
      "orders",
      "averageOrderValue",
      "ordersToFulfill",
    ]);
    expect(cards.map((card) => card.querySelector('svg[viewBox="0 0 100 32"]') !== null)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("links Orders to fulfill to the orders list filtered to them", () => {
    renderKpis();

    expect(screen.getByRole("link", { name: "View orders to fulfill" })).toHaveAttribute(
      "href",
      "/orders?fulfillment=unfulfilled",
    );
  });

  it("formats the figures for an Arabic reader", () => {
    renderKpis(salesReport(), ar, "ar");

    expect(screen.getByRole("heading", { level: 3, name: "إجمالي المبيعات" })).toBeInTheDocument();
    expect(screen.getByText("طلبات محتاجة تجهيز")).toBeInTheDocument();
    expect(screen.getAllByText(/^مقارنة بـ /)).toHaveLength(3);
  });
});

describe("DashboardError", () => {
  it("says it could not load and offers Try again, with no numbers", () => {
    render(<DashboardError title="Total sales" t={en} />);

    expect(screen.getByText("Total sales")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d/);
  });

  it("asks the page to load again when Try again is pressed", () => {
    render(<DashboardError title="Total sales" t={en} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("explains a refusal instead of offering a retry that cannot help", () => {
    render(<DashboardError title="Total sales" t={en} unauthorized />);

    expect(screen.getByText(en.states.unauthorized)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("SalesChart", () => {
  const renderChart = (data = salesReport(), locale: "en" | "ar" = "en") =>
    render(
      <SalesChart
        current={data.current.daily}
        previous={data.previous.daily}
        currency={data.currency}
        t={locale === "en" ? en : ar}
        locale={locale}
      />,
    );

  it("is titled Total sales over time and described for assistive technology", () => {
    renderChart();

    expect(screen.getByText("Total sales over time")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: en.sales.chartLabel })).toBeInTheDocument();
  });

  it("reads out every day of the range, zero days included, in the shop's calendar", () => {
    renderChart();

    const readings = screen
      .getAllByRole("listitem")
      .map((item) => (item.textContent ?? "").replace(/\s/g, " "));
    const days = readings.filter((text) => /\d orders/.test(text));
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("Oct 6: EGP 0, 0 orders (previous period: EGP 0)");
    expect(days[1]).toBe("Oct 7: EGP 100, 2 orders (previous period: EGP 0)");
    expect(days[2]).toBe("Oct 8: EGP 0, 0 orders (previous period: EGP 200)");
  });

  it("draws the current period as a line and the previous period dashed beside it", () => {
    const { container } = renderChart();

    const paths = Array.from(container.querySelectorAll("path[data-series]"));
    expect(paths.map((path) => path.getAttribute("data-series"))).toEqual(["previous", "current"]);
    expect(paths[0]).toHaveAttribute("stroke-dasharray");
    expect(paths[1]).not.toHaveAttribute("stroke-dasharray");
  });

  it("has a legend naming both periods", () => {
    renderChart();

    expect(screen.getByText("This period")).toBeInTheDocument();
    expect(screen.getByText("Previous period")).toBeInTheDocument();
  });

  it("labels the vertical axis in money and the horizontal axis in days", () => {
    const { container } = renderChart();

    const yLabels = Array.from(container.querySelectorAll("[data-y-label]")).map(
      (e) => e.textContent,
    );
    expect(yLabels).toHaveLength(5);
    expect(yLabels.at(-1)).toMatch(/0/);
    const xLabels = Array.from(container.querySelectorAll("[data-x-label]")).map(
      (e) => e.textContent,
    );
    expect(xLabels[0]).toBe("Oct 6");
    expect(xLabels.at(-1)).toBe("Oct 12");
  });

  it("draws a flat line at zero, not an empty chart, when there are no sales", () => {
    const { container } = renderChart(emptyReport());

    expect(container.querySelector('path[data-series="current"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-y-label]")).toHaveLength(5);
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("draws one point for a one-day range", () => {
    const one = salesReport({
      current: {
        ...salesReport().current,
        daily: [{ date: "2026-10-12", salesMinor: 500, orders: 1 }],
      },
      previous: {
        ...salesReport().previous,
        daily: [{ date: "2026-10-11", salesMinor: 0, orders: 0 }],
      },
    });
    const { container } = renderChart(one);

    expect(container.querySelectorAll("circle[data-point]")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("keeps the axis readable on a long range by labelling only some days", () => {
    const days = Array.from({ length: 30 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 8, 14 + index)).toISOString().slice(0, 10),
      salesMinor: index * 100,
      orders: index,
    }));
    const long = salesReport({
      current: { ...salesReport().current, daily: days },
      previous: { ...salesReport().previous, daily: days },
    });
    const { container } = renderChart(long);

    const xLabels = container.querySelectorAll("[data-x-label]");
    expect(xLabels.length).toBeGreaterThan(2);
    expect(xLabels.length).toBeLessThanOrEqual(8);
    expect(screen.getAllByText(/orders \(previous period/)).toHaveLength(30);
  });
});

describe("TopProducts", () => {
  const renderTop = (
    data = salesReport(),
    dictionary: Dictionary = en,
    locale: "en" | "ar" = "en",
  ) =>
    render(
      <TopProducts
        products={data.current.topProducts}
        currency={data.currency}
        t={dictionary}
        locale={locale}
      />,
    );

  it("shows each product's picture, name, variant, units sold and sales", () => {
    renderTop();

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Linen shirt")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Large / Blue")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("5")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("EGP 300.00")).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("img", { name: "Linen shirt" })).toHaveAttribute(
      "src",
      "https://media.example/shirt.jpg",
    );
    expect(within(rows[1]!).getByText("Canvas tote")).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole("img")).not.toBeInTheDocument(); // the placeholder
  });

  it("links each product to its page", () => {
    renderTop();

    expect(screen.getByRole("link", { name: "Linen shirt" })).toHaveAttribute(
      "href",
      "/products/p-1",
    );
  });

  it("has no views, conversion or stock columns: nothing is counted for them", () => {
    renderTop();

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Product", "Units sold", "Sales"]);
  });

  it("says there were no sales, rather than listing sample products, when there are none", () => {
    renderTop(emptyReport());

    expect(screen.getByText("No sales in this period")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("is titled in Arabic for an Arabic reader", () => {
    renderTop(salesReport(), ar, "ar");

    expect(screen.getByText("أكتر المنتجات مبيعًا")).toBeInTheDocument();
  });
});
