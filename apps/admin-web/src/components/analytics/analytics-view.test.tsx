import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsView } from "./analytics-view";
import { emptyReport, salesReport } from "@/components/dashboard/test-fixtures";
import type { FetchSalesAnalyticsResult } from "@/lib/api/sales-analytics";
import { dictionaryFor } from "@/lib/i18n";
import { en, type Dictionary } from "@/messages/en";

const ar: Dictionary = dictionaryFor("ar");

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderAnalytics(
  result: FetchSalesAnalyticsResult,
  options: { t?: Dictionary; locale?: "en" | "ar" } = {},
) {
  return render(
    <AnalyticsView
      t={options.t ?? en}
      locale={options.locale ?? "en"}
      range="7d"
      result={result}
    />,
  );
}

const NOT_REAL =
  /demo|sample|reporting unavailable|conversion|metric catalog|definition catalog|read store|تجريبي/i;

describe("AnalyticsView", () => {
  it("is titled Analytics and has the same date ranges as Home, on its own URL", () => {
    renderAnalytics({ outcome: "ok", data: salesReport() });

    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Last 30 days" })).toHaveAttribute(
      "href",
      "/analytics?range=30d",
    );
  });

  it("shows sales, orders and average order value, the chart and the top products", () => {
    renderAnalytics({ outcome: "ok", data: salesReport() });

    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Total sales",
      "Orders",
      "Average order value",
    ]);
    expect(screen.getByText("EGP 500.00")).toBeInTheDocument();
    expect(screen.getByText("Total sales over time")).toBeInTheDocument();
    expect(screen.getByText("Top products by units sold")).toBeInTheDocument();
    expect(screen.getByText("Linen shirt")).toBeInTheDocument();
  });

  it("has no orders-to-fulfill card: that is a to-do on Home, not a figure of the period", () => {
    renderAnalytics({ outcome: "ok", data: salesReport() });

    expect(screen.queryByText("Orders to fulfill")).not.toBeInTheDocument();
  });

  it("shows zeros as zeros with no sample values, and no metric catalog", () => {
    renderAnalytics({ outcome: "ok", data: emptyReport() });

    expect(screen.getAllByText("EGP 0.00")).toHaveLength(2);
    expect(screen.getByText("No sales in this period")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NOT_REAL);
  });

  it("says how many orders in other currencies are left out", () => {
    const data = salesReport();
    renderAnalytics({
      outcome: "ok",
      data: { ...data, current: { ...data.current, otherCurrencyOrders: 2 } },
    });

    expect(screen.getByText("2 orders in other currencies aren't included.")).toBeInTheDocument();
  });

  it("shows an error with Try again on every card, and no numbers, when the figures cannot be loaded", () => {
    renderAnalytics({ outcome: "error", message: "boom" });

    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(5);
    expect(document.body.textContent).not.toMatch(/EGP/);
    // the cards say nothing but that they could not load: no figure of any kind
    for (const note of screen.getAllByRole("note")) expect(note.textContent).not.toMatch(/\d/);
  });

  it("explains a refusal instead of offering a retry", () => {
    renderAnalytics({ outcome: "unauthorized" });

    expect(screen.getAllByText(en.states.unauthorized)).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("reads in Arabic", () => {
    renderAnalytics({ outcome: "ok", data: salesReport() }, { t: ar, locale: "ar" });

    expect(
      screen.getByRole("heading", { level: 1, name: ar.analyticsPage.title }),
    ).toBeInTheDocument();
    expect(screen.getByText("إجمالي المبيعات")).toBeInTheDocument();
  });
});
