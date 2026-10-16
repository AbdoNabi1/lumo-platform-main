import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeView } from "./home-view";
import { emptyReport, salesReport } from "./test-fixtures";
import type { FetchSalesAnalyticsResult } from "@/lib/api/sales-analytics";
import { dictionaryFor } from "@/lib/i18n";
import { en, type Dictionary } from "@/messages/en";

/** The Arabic dictionary, typed as the widened `Dictionary` the components take. */
const ar: Dictionary = dictionaryFor("ar");

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const recentOrdersSlot = <section aria-label="recent-orders-slot" />;

function renderHome(
  result: FetchSalesAnalyticsResult,
  options: { t?: Dictionary; locale?: "en" | "ar"; range?: "7d" | "today" } = {},
) {
  return render(
    <HomeView
      t={options.t ?? en}
      locale={options.locale ?? "en"}
      userName="Abdullah"
      range={options.range ?? "7d"}
      result={result}
      recentOrders={recentOrdersSlot}
    />,
  );
}

/** Everything that says "this number is not real": it must appear nowhere on Home. */
const NOT_REAL =
  /demo|sample|reporting unavailable|conversion|sales by channel|تجريبي|معدل التحويل/i;

describe("HomeView: a shop with no orders", () => {
  it("shows zeros as zeros, empty states, and no demo text anywhere", () => {
    renderHome({ outcome: "ok", data: emptyReport() });

    expect(screen.getAllByText("EGP 0.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("No sales in this period")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NOT_REAL);
    expect(document.body.textContent).not.toMatch(/128,340|1,482|2\.34%/);
  });

  it("says the same in Arabic", () => {
    renderHome({ outcome: "ok", data: emptyReport() }, { t: ar, locale: "ar" });

    expect(screen.getByText("مفيش مبيعات في الفترة دي")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NOT_REAL);
  });
});

describe("HomeView: a shop with orders", () => {
  it("lays out the header, the four cards, the chart, the top products and recent orders", () => {
    renderHome({ outcome: "ok", data: salesReport() });

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    expect(screen.getByText("Total sales over time")).toBeInTheDocument();
    expect(screen.getByText("Top products by units sold")).toBeInTheDocument();
    expect(screen.getByLabelText("recent-orders-slot")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NOT_REAL);
  });

  it("labels the comparison with the dates of the period before, in the shop's calendar", () => {
    renderHome({ outcome: "ok", data: salesReport() });

    expect(screen.getAllByText("vs Sep 29 – Oct 5").length).toBe(3);
  });

  it("says how many orders in other currencies are not counted, when there are some", () => {
    const data = salesReport();
    renderHome({
      outcome: "ok",
      data: { ...data, current: { ...data.current, otherCurrencyOrders: 3 } },
    });

    expect(screen.getByText("3 orders in other currencies aren't included.")).toBeInTheDocument();
  });

  it("says nothing about other currencies when there are none", () => {
    renderHome({ outcome: "ok", data: salesReport() });

    expect(screen.queryByText(/other currencies/)).not.toBeInTheDocument();
  });

  it("says it in Arabic with the count", () => {
    const data = salesReport();
    renderHome(
      { outcome: "ok", data: { ...data, current: { ...data.current, otherCurrencyOrders: 3 } } },
      { t: ar, locale: "ar" },
    );

    expect(
      screen.getByText(
        /^فيه .*3.* طلبات بعملة تانية مش محسوبة\.$|^فيه .*٣.* طلبات بعملة تانية مش محسوبة\.$/,
      ),
    ).toBeInTheDocument();
  });
});

describe("HomeView: the API cannot be reached", () => {
  it("gives every card an error with Try again and shows no numbers from anywhere", () => {
    renderHome({ outcome: "error", message: "connect ECONNREFUSED" });

    const retries = screen.getAllByRole("button", { name: "Try again" });
    expect(retries).toHaveLength(6); // four cards, the chart, the top products
    expect(screen.getAllByText("Couldn't load")).toHaveLength(6);
    expect(document.body.textContent).not.toMatch(/EGP|\$|128|1,482/);
    expect(document.body.textContent).not.toMatch(NOT_REAL);
  });

  it("still offers the date ranges and shows recent orders (which load on their own)", () => {
    renderHome({ outcome: "error", message: "boom" });

    expect(screen.getByRole("navigation", { name: en.header.dateRange })).toBeInTheDocument();
    expect(screen.getByLabelText("recent-orders-slot")).toBeInTheDocument();
  });

  it("explains a refusal on each card instead of retrying", () => {
    renderHome({ outcome: "unauthorized" });

    expect(screen.getAllByText(en.states.unauthorized)).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("Home copy", () => {
  const keysOf = (value: unknown, path = ""): string[] =>
    typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([key, child]) => keysOf(child, `${path}.${key}`))
      : [path];

  it.each([
    ["en", en],
    ["ar", ar],
  ])("has no demo, sample or channel keys in the %s dictionary", (_name, dictionary) => {
    const home = {
      header: dictionary.header,
      kpi: dictionary.kpi,
      sales: dictionary.sales,
      recentOrders: dictionary.recentOrders,
      topProducts: dictionary.topProducts,
      states: dictionary.states,
    };
    expect(
      keysOf(home).filter((key) => /demo|sample|channel|conversion|provenance/i.test(key)),
    ).toEqual([]);
    expect(dictionary).not.toHaveProperty("data");
    expect(dictionary).not.toHaveProperty("channels");
  });

  it("is the same set of keys in English and Arabic", () => {
    expect(keysOf(ar.header).sort()).toEqual(keysOf(en.header).sort());
    expect(keysOf(ar.kpi).sort()).toEqual(keysOf(en.kpi).sort());
    expect(keysOf(ar.states).sort()).toEqual(keysOf(en.states).sort());
  });
});
