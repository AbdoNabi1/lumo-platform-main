import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, SearchXIcon, UsersIcon } from "lucide-react";
import { Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CustomersHeader } from "@/components/customers/customers-header";
import { CustomersPagination } from "@/components/customers/customers-pagination";
import { CustomersTable } from "@/components/customers/customers-table";
import { CustomersToolbar } from "@/components/customers/customers-toolbar";
import { fetchCustomersPage } from "@/lib/api/customers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface CustomersPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly after?: string;
    /** Set by the export route handler when it sends the merchant back instead of a file. */
    readonly exportError?: string;
  }>;
}

/**
 * The Customers list screen (Phase A.30). Same server-component/URL-driven-filters/streaming
 * pattern as the Orders list screen (`app/orders/page.tsx`) — filters live in `?q=&after=`, the
 * shell renders immediately, only the results resolve inside `<Suspense>`. Never falls back to
 * demo data on failure.
 */
export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;
  // Operators and admins add and export customers (the API enforces `customers:register` and
  // `customers:export`); a viewer or an unknown role gets neither button.
  const role = highestRole((await readSession())?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";
  const canExport = canEdit;
  const exportError = (["too_many", "failed"] as const).find(
    (error) => error === params.exportError,
  );

  return (
    <AppShell t={t} locale={locale} activeNavId="customers" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <CustomersHeader canEdit={canEdit} canExport={canExport} t={t} />

        <CustomersToolbar t={t} />

        {exportError !== undefined && (
          <p
            role="alert"
            className="bg-warning-subtle text-warning-foreground rounded-2xl px-4 py-3 text-base"
          >
            {t.customersPage.exportError[exportError]}
          </p>
        )}

        <Suspense
          key={`${params.q ?? ""}:${params.after ?? ""}`}
          fallback={<CustomersTableSkeleton />}
        >
          <CustomersResults first={PAGE_SIZE} after={params.after} search={params.q} t={t} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function CustomersResults({
  first,
  after,
  search,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly search: string | undefined;
  readonly t: Dictionary;
}) {
  const hasFilters = Boolean(search);
  const result = await fetchCustomersPage({ first, after, search });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.customersPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.customersPage.error}
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
            <UsersIcon aria-hidden="true" className="size-5" />
          )
        }
        message={hasFilters ? t.customersPage.emptyFiltered : t.customersPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <CustomersTable customers={result.items} t={t} />
      </CardContent>
      <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
        <CustomersPagination
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

function CustomersTableSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-0 sm:p-0">
        <div className="flex flex-col">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
            >
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="ms-auto h-4 w-40" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
