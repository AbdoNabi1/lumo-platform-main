import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LayersIcon, LockIcon, PlusIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CollectionsPagination } from "@/components/collections/collections-pagination";
import { CollectionsSearch } from "@/components/collections/collections-search";
import { CollectionsTable } from "@/components/collections/collections-table";
import { fetchCollectionsPage } from "@/lib/api/collections";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface CollectionsPageProps {
  readonly searchParams: Promise<{ readonly q?: string; readonly after?: string }>;
}

/**
 * Shopify parity Wave 1a — Collections (`GET /collections`): title, "Create collection", a search
 * box, and a table of Title · Products · Status with cursor pagination.
 */
export default async function CollectionsPage({ searchParams }: CollectionsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, session, params] = await Promise.all([
    getCurrentUser(),
    readSession(),
    searchParams,
  ]);
  const role = highestRole(session?.roles ?? []);
  // `/collections/new` needs an operator; a viewer is not offered a link the gate would refuse.
  const canCreate = role === "operator" || role === "admin";
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const after = typeof params.after === "string" && params.after !== "" ? params.after : undefined;

  return (
    <AppShell t={t} locale={locale} activeNavId="collections" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{t.collections.title}</h1>
          {canCreate && <CreateButton t={t} />}
        </header>

        <Card>
          <div className="border-border border-b px-4 py-3 sm:px-5">
            <CollectionsSearch t={t} />
          </div>
          <Suspense key={`${q}|${after ?? ""}`} fallback={<CollectionsSkeleton />}>
            <CollectionsResults q={q} after={after} t={t} locale={locale} canCreate={canCreate} />
          </Suspense>
        </Card>
      </div>
    </AppShell>
  );
}

function CreateButton({ t }: { readonly t: Dictionary }) {
  return (
    <Button asChild>
      <Link href="/collections/new">
        <PlusIcon aria-hidden="true" />
        {t.collections.create}
      </Link>
    </Button>
  );
}

async function CollectionsResults({
  q,
  after,
  t,
  locale,
  canCreate,
}: {
  readonly q: string;
  readonly after: string | undefined;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly canCreate: boolean;
}) {
  const result = await fetchCollectionsPage({
    first: PAGE_SIZE,
    ...(after === undefined ? {} : { after }),
    ...(q === "" ? {} : { query: q }),
  });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.collections.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.collections.error}
      />
    );
  }
  if (result.items.length === 0) {
    if (q === "" && after === undefined) {
      return (
        <CardContent className="flex flex-col items-center gap-3 px-4 py-16 text-center sm:px-5">
          <LayersIcon aria-hidden="true" className="text-muted-foreground size-6" />
          <h2 className="text-lg font-semibold">{t.collections.emptyTitle}</h2>
          <p className="text-muted-foreground max-w-md text-sm">{t.collections.emptyBody}</p>
          {canCreate && <CreateButton t={t} />}
        </CardContent>
      );
    }
    return (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={t.collections.noMatches}
      />
    );
  }

  return (
    <>
      <CardContent className="p-0 sm:p-0">
        <CollectionsTable collections={result.items} t={t} locale={locale} />
      </CardContent>
      <div className="border-border flex items-center justify-end border-t px-4 py-3 sm:px-5">
        <CollectionsPagination
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

function CollectionsSkeleton() {
  return (
    <CardContent className="p-0 sm:p-0" aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </CardContent>
  );
}
