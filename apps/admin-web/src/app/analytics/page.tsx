import { cookies } from "next/headers";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { AppShell } from "@/components/app-shell";
import { fetchSalesAnalytics } from "@/lib/api/sales-analytics";
import { getCurrentUser } from "@/lib/auth/current-user";
import { parseRange } from "@/lib/dashboard/ranges";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface AnalyticsPageProps {
  readonly searchParams: Promise<{ readonly range?: string | string[] }>;
}

/**
 * The Analytics screen (Plan 3D): the shop's sales, orders, average order value, a chart over time and
 * the top products for a chosen date range (`?range=7d`, the same presets as Home), all computed from
 * the shop's orders. It used to list the metric catalog only; every figure here is a real one, and a
 * shop with no orders sees zeros.
 */
export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const range = parseRange((await searchParams).range);
  const result = await fetchSalesAnalytics(range);

  return (
    <AppShell t={t} locale={locale} activeNavId="analytics" user={user}>
      <AnalyticsView t={t} locale={locale} range={range} result={result} />
    </AppShell>
  );
}
