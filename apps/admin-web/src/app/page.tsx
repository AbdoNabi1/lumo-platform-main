import { Suspense } from "react";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { HomeView } from "@/components/dashboard/home-view";
import {
  RecentOrdersSection,
  RecentOrdersSkeleton,
} from "@/components/dashboard/recent-orders-section";
import { fetchSalesAnalytics } from "@/lib/api/sales-analytics";
import { getCurrentUser } from "@/lib/auth/current-user";
import { parseRange } from "@/lib/dashboard/ranges";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface HomePageProps {
  readonly searchParams: Promise<{ readonly range?: string | string[] }>;
}

/**
 * Home (Plan 3D), like Shopify's: total sales, orders, average order value and orders to fulfill for
 * the chosen date range against the range before it, a sales chart, top products and the latest
 * orders. A server component: it reads the range from the URL (`?range=7d`), fetches the figures on
 * the server and renders them; every number is computed from the shop's orders, and a shop with none
 * sees zeros. If the figures cannot be loaded each card says so with "Try again", never sample
 * numbers. The latest orders stream in on their own, in their own Suspense boundary.
 */
export default async function HomePage({ searchParams }: HomePageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const range = parseRange((await searchParams).range);
  const result = await fetchSalesAnalytics(range);

  return (
    <AppShell t={t} locale={locale} activeNavId="dashboard" user={user}>
      <HomeView
        t={t}
        locale={locale}
        userName={user.name.split(" ")[0] ?? user.name}
        range={range}
        result={result}
        recentOrders={
          <Suspense fallback={<RecentOrdersSkeleton t={t} />}>
            <RecentOrdersSection t={t} locale={locale} />
          </Suspense>
        }
      />
    </AppShell>
  );
}
