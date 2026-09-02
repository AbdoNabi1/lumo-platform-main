import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, MapIcon, PlusIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { SeoPagination } from "@/components/seo/seo-pagination";
import { SitemapsTable } from "@/components/seo/sitemaps-table";
import { fetchSitemapsPage } from "@/lib/api/seo";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface SitemapsPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Sitemaps list screen (T5.9b) — no frontend existed for the SEO domain before this task.
 * Backed by `GET /seo/sitemaps` (fully DTO-mapped: `SitemapDto`).
 */
export default async function SitemapsPage({ searchParams }: SitemapsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">{t.sitemapsPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.sitemapsPage.subtitle}</p>
        </div>
        <Button asChild>
          <Link href="/seo/sitemaps/new">
            <PlusIcon aria-hidden="true" />
            {t.sitemapsPage.newSitemap}
          </Link>
        </Button>
      </header>

      <Suspense key={params.after ?? ""} fallback={<TableSkeleton />}>
        <SitemapsResults first={PAGE_SIZE} after={params.after} t={t} />
      </Suspense>
    </div>
  );
}

async function SitemapsResults({
  first,
  after,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchSitemapsPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.sitemapsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.sitemapsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<MapIcon aria-hidden="true" className="size-5" />}
        message={t.sitemapsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <SitemapsTable sitemaps={result.items} t={t} />
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
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
