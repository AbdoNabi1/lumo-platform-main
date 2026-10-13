import type { FetchSalesAnalyticsResult } from "@/lib/api/sales-analytics";
import type { DashboardRange } from "@/lib/dashboard/ranges";
import { formatCalendarRange, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { DashboardError } from "@/components/dashboard/dashboard-error";
import { HomeKpis } from "@/components/dashboard/home-kpis";
import { RangePicker } from "@/components/dashboard/range-picker";
import { SalesChart } from "@/components/dashboard/sales-chart";
import { TopProducts } from "@/components/dashboard/top-products";

/**
 * Analytics (Plan 3D): the same real figures as Home, for the same date ranges, without Home's to-do
 * cards and recent orders: total sales, orders and average order value against the period before, the
 * sales chart and the top products. Computed from the shop's orders; a shop with none sees zeros, and
 * figures that cannot be loaded show an error with "Try again", never sample numbers.
 */
export function AnalyticsView({
  t,
  locale,
  range,
  result,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly range: DashboardRange;
  readonly result: FetchSalesAnalyticsResult;
}) {
  const unauthorized = result.outcome === "unauthorized";
  const failed = (title: string, as: "h2" | "h3") => (
    <DashboardError key={title} title={title} t={t} as={as} unauthorized={unauthorized} />
  );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 sm:gap-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-4xl font-semibold tracking-tight">{t.analyticsPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.analyticsPage.subtitle}</p>
        </div>
        <RangePicker t={t} range={range} path="/analytics" />
      </header>

      {result.outcome === "ok" ? (
        <>
          {result.data.current.otherCurrencyOrders > 0 && (
            <p
              role="note"
              className="bg-warning-subtle text-warning-foreground rounded-2xl px-5 py-4 text-base"
            >
              {t.sales.otherCurrencies.replace(
                "{count}",
                formatNumber(locale, result.data.current.otherCurrencyOrders),
              )}
            </p>
          )}

          <HomeKpis
            data={result.data}
            t={t}
            locale={locale}
            comparisonLabel={formatCalendarRange(
              locale,
              result.data.previousRange.from,
              result.data.previousRange.to,
            )}
            showOrdersToFulfill={false}
            label={t.analyticsPage.title}
          />

          <SalesChart
            current={result.data.current.daily}
            previous={result.data.previous.daily}
            currency={result.data.currency}
            t={t}
            locale={locale}
          />

          <TopProducts
            products={result.data.current.topProducts}
            currency={result.data.currency}
            t={t}
            locale={locale}
          />
        </>
      ) : (
        <>
          <section
            aria-label={t.analyticsPage.title}
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0"
          >
            {[t.kpi.totalSales, t.kpi.orders, t.kpi.averageOrderValue].map((title) =>
              failed(title, "h3"),
            )}
          </section>
          {failed(t.sales.title, "h2")}
          {failed(t.topProducts.title, "h2")}
        </>
      )}
    </div>
  );
}
