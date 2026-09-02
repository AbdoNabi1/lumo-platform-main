import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  AlertTriangleIcon,
  LockIcon,
  PackageSearchIcon,
  PlusIcon,
  SearchXIcon,
  UploadIcon,
} from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { OrdersPagination } from "@/components/orders/orders-pagination";
import { OrdersTable } from "@/components/orders/orders-table";
import { OrdersToolbar } from "@/components/orders/orders-toolbar";
import { fetchOrdersPage } from "@/lib/api/orders";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface OrdersPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly status?: string;
    readonly after?: string;
  }>;
}

/**
 * The Orders list screen (Phase 2 admin-web productization). A server component: filters live in
 * the URL (`?q=&status=&after=`, driven by the client `OrdersToolbar`/`OrdersPagination`), so
 * every state is reachable by URL and survives a refresh/back-button. The chrome (shell, header,
 * toolbar) renders immediately; only the results resolve inside their own `<Suspense>` boundary
 * (same streaming pattern as the Dashboard's `RecentOrdersSection`), so the sidebar/topbar are
 * never blocked on `GET /orders`. Never falls back to demo data on failure.
 */
export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="orders" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t.ordersPage.title}</h1>
            <p className="text-md text-muted-foreground mt-1">{t.ordersPage.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/orders/from-checkout">
                <UploadIcon aria-hidden="true" />
                {t.ordersPage.createFromCheckout}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/orders/new">
                <PlusIcon aria-hidden="true" />
                {t.ordersPage.newOrder}
              </Link>
            </Button>
          </div>
        </header>

        <OrdersToolbar t={t} />

        <Suspense
          key={`${params.q ?? ""}:${params.status ?? ""}:${params.after ?? ""}`}
          fallback={<OrdersTableSkeleton />}
        >
          <OrdersResults
            first={PAGE_SIZE}
            after={params.after}
            status={params.status}
            search={params.q}
            t={t}
            locale={locale}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function OrdersResults({
  first,
  after,
  status,
  search,
  t,
  locale,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly status: string | undefined;
  readonly search: string | undefined;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const hasFilters = Boolean(search) || Boolean(status);
  const result = await fetchOrdersPage({ first, after, status, search });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.ordersPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.ordersPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={
          hasFilters ? (
            <SearchXIcon aria-hidden="true" className="size-5" />
          ) : (
            <PackageSearchIcon aria-hidden="true" className="size-5" />
          )
        }
        message={hasFilters ? t.ordersPage.emptyFiltered : t.ordersPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <OrdersTable orders={result.items} t={t} locale={locale} />
      </CardContent>
      <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
        <OrdersPagination
          hasNextPage={result.pageInfo.hasNextPage}
          endCursor={result.pageInfo.endCursor}
          t={t}
        />
      </div>
    </Card>
  );
}

function StatePanel({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note">{message}</p>
      </CardContent>
    </Card>
  );
}

function OrdersTableSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-0 sm:p-0">
        <div className="flex flex-col">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
            >
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="ms-auto h-4 w-16" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
