import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, SearchXIcon, ShoppingCartIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { AbandonedCheckoutsFilters } from "@/components/abandoned-checkouts/abandoned-checkouts-filters";
import { AbandonedCheckoutsTable } from "@/components/abandoned-checkouts/abandoned-checkouts-table";
import { AppShell } from "@/components/app-shell";
import { OrdersPagination } from "@/components/orders/orders-pagination";
import { fetchAbandonedCheckouts } from "@/lib/api/abandoned-checkouts";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { ABANDONED_PAGE_SIZE, parseRecoveryFilter } from "@/lib/orders/abandoned-checkouts";

interface AbandonedCheckoutsPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly recovery?: string;
    readonly after?: string;
  }>;
}

/**
 * Orders → Abandoned checkouts (order operations Part 3, Shopify's screen): checkouts customers left
 * after entering an email or phone, an hour after their last activity, and the recovered ones.
 */
export default async function AbandonedCheckoutsPage({
  searchParams,
}: AbandonedCheckoutsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const a = t.abandonedCheckouts;
  const user = await getCurrentUser();
  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const recovery = parseRecoveryFilter(params.recovery);
  const filtered = q !== undefined || recovery !== undefined;
  const result = await fetchAbandonedCheckouts({
    first: ABANDONED_PAGE_SIZE,
    after: params.after,
    q,
    recovery,
  });

  let content: ReactNode;
  if (result.outcome === "unauthorized") {
    content = (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={a.unauthorized}
      />
    );
  } else if (result.outcome !== "ok") {
    content = (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={a.error}
      />
    );
  } else if (result.data.items.length === 0) {
    content = filtered ? (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={a.emptyFiltered}
      />
    ) : (
      <StatePanel
        icon={<ShoppingCartIcon aria-hidden="true" className="size-5" />}
        message={a.empty}
        detail={a.emptyBody}
      />
    );
  } else {
    content = (
      <Card>
        <CardContent className="p-0 sm:p-0">
          <AbandonedCheckoutsTable checkouts={result.data.items} t={t} locale={locale} />
        </CardContent>
        <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
          <OrdersPagination
            hasNextPage={result.data.pageInfo.hasNextPage}
            endCursor={result.data.pageInfo.endCursor}
            t={t}
          />
        </div>
      </Card>
    );
  }

  return (
    <AppShell t={t} locale={locale} activeNavId="abandoned-checkouts" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{a.title}</h1>
        </header>
        <AbandonedCheckoutsFilters q={q} recovery={recovery} t={t} />
        {content}
      </div>
    </AppShell>
  );
}

function StatePanel({
  icon,
  message,
  detail,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly detail?: string;
}) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note" className="text-foreground font-medium">
          {message}
        </p>
        {detail !== undefined && <p className="max-w-md text-sm">{detail}</p>}
      </CardContent>
    </Card>
  );
}
