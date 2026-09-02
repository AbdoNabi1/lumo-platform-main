import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, InfoIcon, LockIcon, PercentIcon, PlusIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { DiscountsPagination } from "@/components/discounts/discounts-pagination";
import { DiscountsTable } from "@/components/discounts/discounts-table";
import { fetchCouponsPage } from "@/lib/api/discounts";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface DiscountsPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Discounts screen (Phase A.30), backed by `GET /coupons` (Coupons context — the discount
 * *code* itself). "Type"/"value" live on the `Promotion` a coupon authorizes
 * (`services/promotions`), not on the coupon — Promotions now has its own list/detail screen
 * (T5.8 Part B, `/promotions`), so the promotion reference column links there, but this list
 * still only renders fields Coupons owns directly (`t.discountsPage.note`), never a fabricated
 * join. T5.8 Part A added the "New coupon" create screen (`/discounts/new`, which also carries the
 * redeem form) and each row's inline "advance status" control (`DiscountsTable`, gated by
 * `lib/coupon-lifecycle.ts` — same "no detail page, per-row action" shape as `ContentBlocksTable`).
 */
export default async function DiscountsPage({ searchParams }: DiscountsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="discounts" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t.discountsPage.title}</h1>
            <p className="text-md text-muted-foreground mt-1">{t.discountsPage.subtitle}</p>
          </div>
          <Button asChild>
            <Link href="/discounts/new">
              <PlusIcon aria-hidden="true" />
              {t.discountsPage.newCoupon}
            </Link>
          </Button>
        </header>

        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {t.discountsPage.note}
        </p>

        <Suspense key={params.after ?? ""} fallback={<DiscountsTableSkeleton />}>
          <DiscountsResults first={PAGE_SIZE} after={params.after} t={t} locale={locale} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function DiscountsResults({
  first,
  after,
  t,
  locale,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const result = await fetchCouponsPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.discountsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.discountsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<PercentIcon aria-hidden="true" className="size-5" />}
        message={t.discountsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <DiscountsTable items={result.items} t={t} locale={locale} />
      </CardContent>
      <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
        <DiscountsPagination
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

function DiscountsTableSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-0 sm:p-0">
        <div className="flex flex-col">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="ms-auto h-4 w-32" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
