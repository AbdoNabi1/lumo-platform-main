import { PackageSearchIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import { fetchRecentOrders } from "@/lib/api/orders";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { DashboardError } from "./dashboard-error";
import { RecentOrders } from "./recent-orders";

/** How many orders Home lists, whatever the date range. */
const RECENT_ORDERS = 5;

/**
 * Resolves and renders Home's recent orders from the real `GET /orders`. An async Server Component
 * on purpose: rendered inside its own `<Suspense>` boundary in `app/page.tsx` (fallback:
 * {@link RecentOrdersSkeleton}), so it streams in on its own and a slow or failing orders list never
 * blocks, or takes down, the figures above it.
 */
export async function RecentOrdersSection({
  t,
  locale,
  className,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly className?: string;
}) {
  const result = await fetchRecentOrders(RECENT_ORDERS);

  if (result.outcome === "unauthorized") {
    return (
      <DashboardError
        title={t.recentOrders.title}
        t={t}
        as="h2"
        unauthorized
        unauthorizedMessage={t.recentOrders.unauthorized}
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  if (result.outcome === "error") {
    return (
      <DashboardError
        title={t.recentOrders.title}
        t={t}
        as="h2"
        {...(className === undefined ? {} : { className })}
      />
    );
  }

  if (result.orders.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle as="h2">{t.recentOrders.title}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-base sm:px-5">
          <PackageSearchIcon aria-hidden="true" className="size-5" />
          <p role="note">{t.recentOrders.empty}</p>
        </CardContent>
      </Card>
    );
  }

  return <RecentOrders orders={result.orders} t={t} locale={locale} className={className} />;
}

/** `<Suspense>` fallback for {@link RecentOrdersSection}. */
export function RecentOrdersSkeleton({
  t,
  className,
}: {
  readonly t: Dictionary;
  readonly className?: string;
}) {
  return (
    <Card className={className} aria-busy="true" aria-label={t.recentOrders.title}>
      <CardHeader>
        <CardTitle as="h2">{t.recentOrders.title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        <ul className="flex flex-col">
          {Array.from({ length: RECENT_ORDERS }, (_, index) => (
            <li
              key={index}
              className="border-border/60 flex items-center gap-3 border-t px-4 py-3.5 sm:px-5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-14" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
