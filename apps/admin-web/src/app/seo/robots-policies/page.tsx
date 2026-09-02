import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, BotIcon, LockIcon, PlusIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { RobotsPoliciesTable } from "@/components/seo/robots-policies-table";
import { SeoPagination } from "@/components/seo/seo-pagination";
import { fetchRobotsPoliciesPage } from "@/lib/api/seo";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface RobotsPoliciesPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Robots Policies list screen (T5.9b) — no frontend existed for the SEO domain before this
 * task. Backed by `GET /seo/robots-policies` (fully DTO-mapped: `RobotsPolicyDto`). No separate
 * detail page: each row links straight to the pre-filled set form, since `POST
 * /seo/robots-policies` create-or-updates keyed by `userAgent` and there is nothing else to show.
 */
export default async function RobotsPoliciesPage({ searchParams }: RobotsPoliciesPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">{t.robotsPoliciesPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.robotsPoliciesPage.subtitle}</p>
        </div>
        <Button asChild>
          <Link href="/seo/robots-policies/new">
            <PlusIcon aria-hidden="true" />
            {t.robotsPoliciesPage.newPolicy}
          </Link>
        </Button>
      </header>

      <Suspense key={params.after ?? ""} fallback={<TableSkeleton />}>
        <RobotsPoliciesResults first={PAGE_SIZE} after={params.after} t={t} />
      </Suspense>
    </div>
  );
}

async function RobotsPoliciesResults({
  first,
  after,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchRobotsPoliciesPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.robotsPoliciesPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.robotsPoliciesPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<BotIcon aria-hidden="true" className="size-5" />}
        message={t.robotsPoliciesPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <RobotsPoliciesTable policies={result.items} t={t} />
      </CardContent>
      <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3 sm:px-5">
        <SeoPagination hasNextPage={result.pageInfo.hasNextPage} endCursor={result.pageInfo.endCursor} t={t} />
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

function TableSkeleton() {
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
              <Skeleton className="h-4 w-64" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
