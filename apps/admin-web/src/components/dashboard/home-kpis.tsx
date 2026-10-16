import { CircleDollarSignIcon, PackageCheckIcon, ShoppingBagIcon, TagIcon } from "lucide-react";
import type { SalesAnalyticsDto } from "@/lib/api/sales-analytics";
import { changeBetween, trendPoints } from "@/lib/dashboard/change";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { KpiCard } from "./kpi-card";

/**
 * Home's four cards, from the report and nothing else: total sales, orders, average order value
 * (each against the period before it, with a spark of its days) and orders to fulfill (an all-time
 * count that links to the list it counts). There is no conversion card: visits are not counted, so
 * there is no honest number to show.
 */
export function HomeKpis({
  data,
  t,
  locale,
  comparisonLabel,
  showOrdersToFulfill = true,
  label,
}: {
  readonly data: SalesAnalyticsDto;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly comparisonLabel: string;
  /** Home shows the to-do count; Analytics, which describes a period, does not. */
  readonly showOrdersToFulfill?: boolean;
  /** The accessible name of the group; the page title by default. */
  readonly label?: string;
}) {
  const { current, previous, currency } = data;
  return (
    <section
      aria-label={label ?? t.header.title}
      className={
        showOrdersToFulfill
          ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0"
          : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0"
      }
    >
      <KpiCard
        id="totalSales"
        icon={CircleDollarSignIcon}
        accent="info"
        title={t.kpi.totalSales}
        value={formatCurrency(locale, current.totalSalesMinor, currency)}
        change={changeBetween(current.totalSalesMinor, previous.totalSalesMinor)}
        comparisonLabel={comparisonLabel}
        trend={trendPoints(current.daily.map((day) => day.salesMinor))}
        t={t}
        locale={locale}
      />
      <KpiCard
        id="orders"
        icon={ShoppingBagIcon}
        accent="primary"
        title={t.kpi.orders}
        value={formatNumber(locale, current.ordersCount)}
        change={changeBetween(current.ordersCount, previous.ordersCount)}
        comparisonLabel={comparisonLabel}
        trend={trendPoints(current.daily.map((day) => day.orders))}
        t={t}
        locale={locale}
      />
      <KpiCard
        id="averageOrderValue"
        icon={TagIcon}
        accent="success"
        title={t.kpi.averageOrderValue}
        value={formatCurrency(locale, current.averageOrderValueMinor, currency)}
        change={changeBetween(current.averageOrderValueMinor, previous.averageOrderValueMinor)}
        comparisonLabel={comparisonLabel}
        trend={trendPoints(
          current.daily.map((day) => (day.orders === 0 ? 0 : day.salesMinor / day.orders)),
        )}
        t={t}
        locale={locale}
      />
      {showOrdersToFulfill && (
        <KpiCard
          id="ordersToFulfill"
          icon={PackageCheckIcon}
          accent="warning"
          title={t.kpi.ordersToFulfill}
          value={formatNumber(locale, current.ordersToFulfill)}
          hint={t.kpi.ordersToFulfillHint}
          href="/orders?fulfillment=unfulfilled"
          hrefLabel={t.kpi.viewOrdersToFulfill}
          t={t}
          locale={locale}
        />
      )}
    </section>
  );
}
