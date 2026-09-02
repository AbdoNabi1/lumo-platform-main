import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, FlaskConicalIcon, LockIcon, PlusIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ExperimentsPagination } from "@/components/experiments/experiments-pagination";
import { ExperimentsTable } from "@/components/experiments/experiments-table";
import { fetchExperimentsPage } from "@/lib/api/experimentation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface ExperimentsPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Experiments list screen (T5.11b). No frontend existed for the Experimentation domain before
 * this task. A server component: the chrome (shell, header) renders immediately; only the results
 * resolve inside their own `<Suspense>` boundary, so the sidebar/topbar are never blocked on
 * `GET /experiments`. Never falls back to demo data on failure, same discipline as every prior
 * Phase 5 list screen.
 */
export default async function ExperimentsPage({ searchParams }: ExperimentsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="experiments" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t.experimentsPage.title}</h1>
            <p className="text-md text-muted-foreground mt-1">{t.experimentsPage.subtitle}</p>
          </div>
          <Button asChild>
            <Link href="/experiments/new">
              <PlusIcon aria-hidden="true" />
              {t.experimentsPage.newExperiment}
            </Link>
          </Button>
        </header>

        <Suspense key={params.after ?? ""} fallback={<ExperimentsTableSkeleton />}>
          <ExperimentsResults first={PAGE_SIZE} after={params.after} t={t} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function ExperimentsResults({
  first,
  after,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchExperimentsPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.experimentsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.experimentsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<FlaskConicalIcon aria-hidden="true" className="size-5" />}
        message={t.experimentsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <ExperimentsTable experiments={result.items} t={t} />
      </CardContent>
      <div className="border-border flex items-center justify-end border-t px-4 py-3 sm:px-5">
        <ExperimentsPagination
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

function ExperimentsTableSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-0 sm:p-0">
        <div className="flex flex-col">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="ms-auto h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
