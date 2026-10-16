import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, PercentIcon, SearchXIcon } from "lucide-react";
import { Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DiscountTypeDialog } from "@/components/discounts/discount-type-dialog";
import { DiscountsPagination } from "@/components/discounts/discounts-pagination";
import { DiscountsSearch } from "@/components/discounts/discounts-search";
import { DiscountsTable } from "@/components/discounts/discounts-table";
import { DiscountsTabs } from "@/components/discounts/discounts-tabs";
import { fetchDiscountsPage, isDiscountView, type DiscountView } from "@/lib/api/discounts";
import { storeSettingsOrDefaults } from "@/lib/api/store-settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface DiscountsPageProps {
  readonly searchParams: Promise<{
    readonly view?: string;
    readonly q?: string;
    readonly after?: string;
  }>;
}

/**
 * Phase 2 Part 2 — Shopify's Discounts list (`GET /discounts`): "Create discount" opens the type
 * dialog; tabs All · Active · Scheduled · Expired; search by title or code; cursor pagination.
 */
export default async function DiscountsPage({ searchParams }: DiscountsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;
  const view: DiscountView = isDiscountView(params.view) ? params.view : "all";
  const q = params.q?.trim() ?? "";

  return (
    <AppShell t={t} locale={locale} activeNavId="discounts" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{t.discounts.title}</h1>
          <DiscountTypeDialog t={t} />
        </header>

        <Card>
          <div className="border-border flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <DiscountsTabs view={view} q={q} t={t} />
            <DiscountsSearch t={t} />
          </div>
          <Suspense key={`${view}|${q}|${params.after ?? ""}`} fallback={<DiscountsSkeleton />}>
            <DiscountsResults view={view} q={q} after={params.after} t={t} locale={locale} />
          </Suspense>
        </Card>
      </div>
    </AppShell>
  );
}

async function DiscountsResults({
  view,
  q,
  after,
  t,
  locale,
}: {
  readonly view: DiscountView;
  readonly q: string;
  readonly after: string | undefined;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const [result, settings] = await Promise.all([
    fetchDiscountsPage({ view, q, first: PAGE_SIZE, ...(after === undefined ? {} : { after }) }),
    storeSettingsOrDefaults(),
  ]);

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.discounts.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.discounts.error}
      />
    );
  }
  if (result.items.length === 0) {
    if (view === "all" && q === "" && after === undefined) {
      return (
        <CardContent className="flex flex-col items-center gap-3 px-4 py-16 text-center sm:px-5">
          <PercentIcon aria-hidden="true" className="text-muted-foreground size-6" />
          <h2 className="text-lg font-semibold">{t.discounts.emptyTitle}</h2>
          <p className="text-muted-foreground max-w-md text-sm">{t.discounts.emptyBody}</p>
          <DiscountTypeDialog t={t} />
        </CardContent>
      );
    }
    return (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={q === "" ? t.discounts.noneInView : t.discounts.noMatches}
      />
    );
  }

  return (
    <>
      <CardContent className="p-0 sm:p-0">
        <DiscountsTable
          items={result.items}
          t={t}
          locale={locale}
          currency={settings.currency}
          timeZone={settings.timezone}
        />
      </CardContent>
      <div className="border-border flex items-center justify-end border-t px-4 py-3 sm:px-5">
        <DiscountsPagination
          hasNextPage={result.pageInfo.hasNextPage}
          endCursor={result.pageInfo.endCursor}
          t={t}
        />
      </div>
    </>
  );
}

function StatePanel({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
      {icon}
      <p role="note">{message}</p>
    </CardContent>
  );
}

function DiscountsSkeleton() {
  return (
    <CardContent className="p-0 sm:p-0" aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="ms-auto h-4 w-12" />
        </div>
      ))}
    </CardContent>
  );
}
