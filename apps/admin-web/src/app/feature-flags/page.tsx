import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, PlusIcon, ToggleLeftIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { FeatureFlagsPagination } from "@/components/feature-flags/feature-flags-pagination";
import { FeatureFlagsTable } from "@/components/feature-flags/feature-flags-table";
import { fetchFeatureFlagsPage } from "@/lib/api/feature-flags";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface FeatureFlagsPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Feature Flags list screen (T5.11b). No frontend existed for the Feature Flags domain before
 * this task. This is a **different** backend domain from the existing read-only Feature Registry
 * screen (`app/feature-registry`) — `services/feature-flags`, boolean/percentage rollout toggles,
 * not `services/feature-registry`'s capability/dependency graph.
 *
 * A server component: the chrome (shell, header) renders immediately; only the results resolve
 * inside their own `<Suspense>` boundary, so the sidebar/topbar are never blocked on
 * `GET /feature-flags`. Never falls back to demo data on failure, same discipline as every prior
 * Phase 5 list screen.
 */
export default async function FeatureFlagsPage({ searchParams }: FeatureFlagsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="feature-flags" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t.featureFlagsPage.title}</h1>
            <p className="text-md text-muted-foreground mt-1">{t.featureFlagsPage.subtitle}</p>
          </div>
          <Button asChild>
            <Link href="/feature-flags/new">
              <PlusIcon aria-hidden="true" />
              {t.featureFlagsPage.newFeatureFlag}
            </Link>
          </Button>
        </header>

        <Suspense key={params.after ?? ""} fallback={<FeatureFlagsTableSkeleton />}>
          <FeatureFlagsResults first={PAGE_SIZE} after={params.after} t={t} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function FeatureFlagsResults({
  first,
  after,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchFeatureFlagsPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.featureFlagsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.featureFlagsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<ToggleLeftIcon aria-hidden="true" className="size-5" />}
        message={t.featureFlagsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <FeatureFlagsTable flags={result.items} t={t} />
      </CardContent>
      <div className="border-border flex items-center justify-end border-t px-4 py-3 sm:px-5">
        <FeatureFlagsPagination
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

function FeatureFlagsTableSkeleton() {
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
