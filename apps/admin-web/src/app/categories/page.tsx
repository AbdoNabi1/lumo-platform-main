import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, FolderTreeIcon, LockIcon } from "lucide-react";
import { Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CategoriesPagination } from "@/components/categories/categories-pagination";
import { CategoriesTable } from "@/components/categories/categories-table";
import { CategoryCreateForm } from "@/components/categories/category-create-form";
import { fetchCategoriesPage } from "@/lib/api/categories";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface CategoriesPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Categories list screen (T5.7) — a flat, cursor-paginated view of the category tree (no tree
 * widget, per the brief) with inline create/move/delete. Backed by the new `GET /categories`
 * DTO-mapped route this task added (`docs/plans/BLOCKERS.md`'s T5.1 entry).
 */
export default async function CategoriesPage({ searchParams }: CategoriesPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="categories" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight">{t.categoriesPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.categoriesPage.subtitle}</p>
        </header>

        <Suspense key={params.after ?? ""} fallback={<CategoriesTableSkeleton />}>
          <CategoriesResults first={PAGE_SIZE} after={params.after} t={t} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function CategoriesResults({
  first,
  after,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchCategoriesPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.categoriesPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.categoriesPage.error}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <CategoryCreateForm categories={result.items} t={t} />

      {result.items.length === 0 ? (
        <StatePanel
          icon={<FolderTreeIcon aria-hidden="true" className="size-5" />}
          message={t.categoriesPage.empty}
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <CategoriesTable categories={result.items} t={t} />
          </CardContent>
          <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3 sm:px-5">
            <CategoriesPagination
              hasNextPage={result.pageInfo.hasNextPage}
              endCursor={result.pageInfo.endCursor}
              t={t}
            />
          </div>
        </Card>
      )}
    </div>
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

function CategoriesTableSkeleton() {
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
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
