import type { ReactNode } from "react";
import { AlertTriangleIcon, LockIcon, PackageSearchIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import { getRecentOrders } from "@/data/recent-orders";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { RecentOrders } from "./recent-orders";

/**
 * Resolves and renders the Dashboard's Recent Orders widget from the real `GET /orders` endpoint.
 * An async Server Component on purpose: rendered inside its own `<Suspense>` boundary in
 * `app/page.tsx` (fallback: `RecentOrdersSkeleton`), so this one real section can stream in
 * independently of the rest of the still-demo page instead of blocking it.
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
  const result = await getRecentOrders();

  if (result.status === "unauthorized") {
    return (
      <StatePanel
        t={t}
        className={className}
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.recentOrders.unauthorized}
      />
    );
  }

  if (result.status === "error") {
    return (
      <StatePanel
        t={t}
        className={className}
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.recentOrders.error}
      />
    );
  }

  if (result.orders.length === 0) {
    return (
      <StatePanel
        t={t}
        className={className}
        icon={<PackageSearchIcon aria-hidden="true" className="size-5" />}
        message={t.recentOrders.empty}
        live
      />
    );
  }

  return <RecentOrders orders={result.orders} t={t} locale={locale} className={className} live />;
}

function StatePanel({
  t,
  className,
  icon,
  message,
  live = false,
}: {
  readonly t: Dictionary;
  readonly className?: string;
  readonly icon: ReactNode;
  readonly message: string;
  readonly live?: boolean;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{t.recentOrders.title}</CardTitle>
          {live && <Badge variant="success">{t.recentOrders.liveBadge}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-base sm:px-5">
        {icon}
        <p role="note">{message}</p>
      </CardContent>
    </Card>
  );
}

/** `<Suspense>` fallback for {@link RecentOrdersSection} — the existing Morbeh skeleton treatment. */
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
        <CardTitle>{t.recentOrders.title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        <ul className="flex flex-col">
          {Array.from({ length: 5 }, (_, index) => (
            <li
              key={index}
              className="border-border/60 flex items-center gap-3 border-t px-4 py-3.5 sm:px-5"
            >
              <Skeleton className="size-10 shrink-0 rounded-full" />
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
