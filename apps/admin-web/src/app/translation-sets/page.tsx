import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LanguagesIcon, LockIcon, PlusIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { TranslationSetsPagination } from "@/components/translation-sets/translation-sets-pagination";
import { TranslationSetsTable } from "@/components/translation-sets/translation-sets-table";
import { fetchTranslationSetsPage } from "@/lib/api/localization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface TranslationSetsPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Translation Sets list screen (T5.11a). No frontend existed for the Localization domain
 * before this task. A server component: the chrome renders immediately, only the results resolve
 * inside their own `<Suspense>` boundary. Never falls back to demo data on failure.
 */
export default async function TranslationSetsPage({ searchParams }: TranslationSetsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="translation-sets" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">
              {t.translationSetsPage.title}
            </h1>
            <p className="text-md text-muted-foreground mt-1">
              {t.translationSetsPage.subtitle}
            </p>
          </div>
          <Button asChild>
            <Link href="/translation-sets/new">
              <PlusIcon aria-hidden="true" />
              {t.translationSetsPage.newTranslationSet}
            </Link>
          </Button>
        </header>

        <Suspense key={params.after ?? ""} fallback={<TranslationSetsTableSkeleton />}>
          <TranslationSetsResults first={PAGE_SIZE} after={params.after} t={t} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function TranslationSetsResults({
  first,
  after,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchTranslationSetsPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.translationSetsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.translationSetsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<LanguagesIcon aria-hidden="true" className="size-5" />}
        message={t.translationSetsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <TranslationSetsTable translationSets={result.items} t={t} />
      </CardContent>
      <div className="border-border flex items-center justify-end border-t px-4 py-3 sm:px-5">
        <TranslationSetsPagination
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

function TranslationSetsTableSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-0 sm:p-0">
        <div className="flex flex-col">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ms-auto h-4 w-8" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
