import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, GlobeIcon, LockIcon, PlusIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { LocalesPagination } from "@/components/locales/locales-pagination";
import { LocalesTable } from "@/components/locales/locales-table";
import { fetchLocalesPage } from "@/lib/api/localization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface LocalesPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Locales list screen (T5.11a). No frontend existed for the Localization domain before this
 * task. A server component: the chrome renders immediately, only the results resolve inside their
 * own `<Suspense>` boundary. Never falls back to demo data on failure.
 */
export default async function LocalesPage({ searchParams }: LocalesPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="locales" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t.localesPage.title}</h1>
            <p className="text-md text-muted-foreground mt-1">{t.localesPage.subtitle}</p>
          </div>
          <Button asChild>
            <Link href="/locales/new">
              <PlusIcon aria-hidden="true" />
              {t.localesPage.newLocale}
            </Link>
          </Button>
        </header>

        <Suspense key={params.after ?? ""} fallback={<LocalesTableSkeleton />}>
          <LocalesResults first={PAGE_SIZE} after={params.after} t={t} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function LocalesResults({
  first,
  after,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchLocalesPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.localesPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.localesPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<GlobeIcon aria-hidden="true" className="size-5" />}
        message={t.localesPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <LocalesTable locales={result.items} t={t} />
      </CardContent>
      <div className="border-border flex items-center justify-end border-t px-4 py-3 sm:px-5">
        <LocalesPagination
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

function LocalesTableSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-0 sm:p-0">
        <div className="flex flex-col">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
            >
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="ms-auto h-4 w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
