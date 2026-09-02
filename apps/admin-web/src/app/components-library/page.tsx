import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ComponentIcon, LockIcon, PlusIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ComponentsPagination } from "@/components/components-library/components-pagination";
import { ComponentsTable } from "@/components/components-library/components-table";
import { fetchComponentsPage } from "@/lib/api/component-library";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface ComponentsPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Component Library list screen (T5.9c) — no frontend existed for this domain before this
 * task. Backed by `GET /components` (fully DTO-mapped: `ComponentDefinitionDto`), same
 * server-component/URL-driven-cursor/streaming pattern as `ThemesPage`/`TemplatesPage`. Routed
 * under `/components-library` (not `/components`) to avoid colliding with this app's own
 * `src/components/` directory convention — see the task brief.
 */
export default async function ComponentsLibraryPage({ searchParams }: ComponentsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="components-library" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t.componentsPage.title}</h1>
            <p className="text-md text-muted-foreground mt-1">{t.componentsPage.subtitle}</p>
          </div>
          <Button asChild>
            <Link href="/components-library/new">
              <PlusIcon aria-hidden="true" />
              {t.componentsPage.newComponent}
            </Link>
          </Button>
        </header>

        <Suspense key={params.after ?? ""} fallback={<ComponentsTableSkeleton />}>
          <ComponentsResults first={PAGE_SIZE} after={params.after} t={t} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function ComponentsResults({
  first,
  after,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchComponentsPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.componentsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.componentsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<ComponentIcon aria-hidden="true" className="size-5" />}
        message={t.componentsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <ComponentsTable components={result.items} t={t} />
      </CardContent>
      <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3 sm:px-5">
        <ComponentsPagination
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

function ComponentsTableSkeleton() {
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
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
