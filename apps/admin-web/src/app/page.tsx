import { Suspense } from "react";
import { cookies } from "next/headers";
import { InfoIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import {
  RecentOrdersSection,
  RecentOrdersSkeleton,
} from "@/components/dashboard/recent-orders-section";
import { SalesByChannel } from "@/components/dashboard/sales-by-channel";
import { SalesOverview } from "@/components/dashboard/sales-overview";
import { TopProducts } from "@/components/dashboard/top-products";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDashboardData, summarizePageProvenance } from "@/data/dashboard";
import { formatDateRange } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * The Morbeh Dashboard.
 *
 * A server component: it resolves the locale and the dashboard payload, then renders the
 * whole page from Morbeh Design System primitives. No figure on this page is written into a
 * component — every number arrives through `DashboardData`, except Recent Orders, which
 * resolves the real `GET /orders` endpoint in its own Suspense boundary (`RecentOrdersSection`).
 *
 * Every section renders unconditionally now — `data/dashboard.ts`'s module doc explains why the
 * old single page-wide `provenance` flag used to hide the KPIs/Sales Overview/Top Products/Sales
 * By Channel sections entirely. Each section/KPI carries its own `provenance` and renders it
 * honestly (a "Live"/"Demo" tag plus, for a still-demo section, a scoped explanation of exactly
 * why); `summarizePageProvenance` only rolls that up into one coarse reading for the header badge.
 */

export default async function DashboardPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const data = await getDashboardData();
  const pageProvenance = summarizePageProvenance(data);

  const rangeLabel = formatDateRange(locale, data.period.startIso, data.period.endIso);
  const comparisonLabel = formatDateRange(
    locale,
    data.period.comparisonStartIso,
    data.period.comparisonEndIso,
  );

  return (
    <AppShell t={t} locale={locale} activeNavId="dashboard" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 sm:gap-8">
        <DashboardHeader
          t={t}
          userName={user.name.split(" ")[0] ?? user.name}
          rangeLabel={rangeLabel}
          provenance={pageProvenance}
        />

        {pageProvenance !== "live" && (
          <p
            role="note"
            className="bg-warning-subtle text-warning-foreground flex items-start gap-3 rounded-2xl px-5 py-4 text-base"
          >
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {pageProvenance === "demo" ? t.data.demoExplanation : t.data.partialExplanation}
          </p>
        )}

        {/*
          `[&>*]:min-w-0` on every grid: a grid item defaults to `min-width: auto`, which lets a
          wide child (a chart's axis row, a table) push the whole page sideways instead of
          scrolling inside its own card.
        */}
        <section
          aria-label={t.header.title}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0"
        >
          {data.kpis.kpis.map((kpi) => (
            <KpiCard
              key={kpi.id}
              kpi={kpi}
              t={t}
              locale={locale}
              comparisonLabel={comparisonLabel}
            />
          ))}
        </section>

        <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
          <SalesOverview
            points={data.sales.points}
            provenance={data.sales.provenance}
            t={t}
            locale={locale}
            currency={data.currency}
            className="xl:col-span-2"
          />
          <Suspense fallback={<RecentOrdersSkeleton t={t} />}>
            <RecentOrdersSection t={t} locale={locale} />
          </Suspense>
        </div>

        <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
          <TopProducts
            products={data.topProducts.products}
            provenance={data.topProducts.provenance}
            t={t}
            locale={locale}
            className="xl:col-span-2"
          />
          <SalesByChannel
            channels={data.channels.channels}
            total={data.channels.totalRevenue}
            provenance={data.channels.provenance}
            t={t}
            locale={locale}
          />
        </div>
      </div>
    </AppShell>
  );
}
