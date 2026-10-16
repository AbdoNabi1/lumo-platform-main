import type { ReactNode } from "react";
import type { FetchSalesAnalyticsResult } from "@/lib/api/sales-analytics";
import type { DashboardRange } from "@/lib/dashboard/ranges";
import { formatCalendarRange, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { DashboardError } from "./dashboard-error";
import { DashboardHeader } from "./dashboard-header";
import { HomeKpis } from "./home-kpis";
import { SalesChart } from "./sales-chart";
import { TopProducts } from "./top-products";

/**
 * Home, from one report (Plan 3D). Everything on it is a real figure from the shop's orders; a zero is
 * a zero. When the report cannot be loaded each card says so with "Try again" and shows no number at
 * all: there is no fallback and no sample. Recent orders load on their own (`recentOrders` is their
 * Suspense boundary), so they neither wait for, nor depend on, the report.
 */
export function HomeView({
  t,
  locale,
  userName,
  range,
  result,
  recentOrders,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly userName: string;
  readonly range: DashboardRange;
  readonly result: FetchSalesAnalyticsResult;
  readonly recentOrders: ReactNode;
}) {
  const unauthorized = result.outcome === "unauthorized";
  const failed = (title: string, as: "h2" | "h3", className?: string) => (
    <DashboardError
      key={title}
      title={title}
      t={t}
      as={as}
      unauthorized={unauthorized}
      {...(className === undefined ? {} : { className })}
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 sm:gap-8">
      <DashboardHeader t={t} userName={userName} range={range} />

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
          />

          <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
            <SalesChart
              current={result.data.current.daily}
              previous={result.data.previous.daily}
              currency={result.data.currency}
              t={t}
              locale={locale}
              className="xl:col-span-2"
            />
            {recentOrders}
          </div>

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
            aria-label={t.header.title}
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0"
          >
            {[t.kpi.totalSales, t.kpi.orders, t.kpi.averageOrderValue, t.kpi.ordersToFulfill].map(
              (title) => failed(title, "h3"),
            )}
          </section>

          <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
            {failed(t.sales.title, "h2", "xl:col-span-2")}
            {recentOrders}
          </div>

          {failed(t.topProducts.title, "h2")}
        </>
      )}
    </div>
  );
}
