import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, PackageIcon, PlusIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ProductsPagination } from "@/components/products/products-pagination";
import { ProductsTable } from "@/components/products/products-table";
import { ProductsToolbar } from "@/components/products/products-toolbar";
import { fetchProductsPage } from "@/lib/api/products";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface ProductsPageProps {
  readonly searchParams: Promise<{ readonly q?: string; readonly after?: string }>;
}

/**
 * The Products list screen (Phase A.30). Same server-component/URL-driven-filters/streaming
 * pattern as the Orders/Customers list screens — filters live in `?q=&after=`, the shell renders
 * immediately, only the results resolve inside `<Suspense>`. Never falls back to demo data on
 * failure.
 */
export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="products" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t.productsPage.title}</h1>
            <p className="text-md text-muted-foreground mt-1">{t.productsPage.subtitle}</p>
          </div>
          <Button asChild>
            <Link href="/products/new">
              <PlusIcon aria-hidden="true" />
              {t.productsPage.newProduct}
            </Link>
          </Button>
        </header>

        <ProductsToolbar t={t} />

        <Suspense
          key={`${params.q ?? ""}:${params.after ?? ""}`}
          fallback={<ProductsTableSkeleton />}
        >
          <ProductsResults
            first={PAGE_SIZE}
            after={params.after}
            query={params.q}
            t={t}
            locale={locale}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function ProductsResults({
  first,
  after,
  query,
  t,
  locale,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly query: string | undefined;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const hasFilters = Boolean(query);
  const result = await fetchProductsPage({ first, after, query });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.productsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.productsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={
          hasFilters ? (
            <SearchXIcon aria-hidden="true" className="size-5" />
          ) : (
            <PackageIcon aria-hidden="true" className="size-5" />
          )
        }
        message={hasFilters ? t.productsPage.emptyFiltered : t.productsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <ProductsTable products={result.items} t={t} locale={locale} />
      </CardContent>
      <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
        <ProductsPagination
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

function ProductsTableSkeleton() {
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
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="ms-auto h-4 w-10" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
