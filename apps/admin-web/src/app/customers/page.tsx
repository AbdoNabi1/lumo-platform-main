import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, DatabaseIcon, LockIcon, SearchXIcon, UsersIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { CustomersHeader } from "@/components/customers/customers-header";
import { CustomersPagination } from "@/components/customers/customers-pagination";
import { CustomersTable } from "@/components/customers/customers-table";
import { CustomersToolbar, type SegmentOption } from "@/components/customers/customers-toolbar";
import { fetchCustomerSegments } from "@/lib/api/customer-segments";
import { fetchCustomersPage } from "@/lib/api/customers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { segmentDisplayName } from "@/lib/customers/segment-labels";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

interface CustomersPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly after?: string;
    /** The Previous stack: earlier cursors, comma-separated (see `CustomersPagination`). */
    readonly stack?: string;
    /** Wave 1c: list only the members of this segment (a default id or a custom segment's id). */
    readonly segment?: string;
    /** Set by the export route handler when it sends the merchant back instead of a file. */
    readonly exportError?: string;
  }>;
}

/**
 * The Customers list screen (Phase A.30). Same server-component/URL-driven-filters/streaming
 * pattern as the Orders list screen (`app/orders/page.tsx`) — filters live in `?q=&after=`, the
 * shell renders immediately, only the results resolve inside `<Suspense>`. Never falls back to
 * demo data on failure. Wave 1c adds `?segment=` (a segment's live members instead of every
 * customer); `q` and `segment` combine, and either one resets the cursor.
 */
export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, segments] = await Promise.all([getCurrentUser(), fetchCustomerSegments()]);
  const params = await searchParams;
  // The select is only offered when the segment list loaded; a failed list leaves search working.
  const segmentOptions: readonly SegmentOption[] | null =
    segments.outcome === "ok"
      ? segments.data.items.map((segment) => ({
          id: segment.id,
          label: segmentDisplayName(segment, t),
        }))
      : null;
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

        <CustomersToolbar t={t} segments={segmentOptions} />

        {exportError !== undefined && (
          <p
            role="alert"
            className="bg-warning-subtle text-warning-foreground rounded-2xl px-4 py-3 text-base"
          >
            {t.customersPage.exportError[exportError]}
          </p>
        )}

        <Suspense
          key={`${params.q ?? ""}:${params.after ?? ""}:${params.stack ?? ""}:${params.segment ?? ""}`}
          fallback={<CustomersTableSkeleton />}
        >
          <CustomersResults
            first={PAGE_SIZE}
            after={params.after}
            stack={params.stack}
            search={params.q}
            segment={params.segment}
            t={t}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function CustomersResults({
  first,
  after,
  stack,
  search,
  segment,
  t,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly stack: string | undefined;
  readonly search: string | undefined;
  readonly segment: string | undefined;
  readonly t: Dictionary;
}) {
  const hasFilters = Boolean(search) || Boolean(segment);
  // Previous must stay reachable even when a later page turns out empty.
  const hasCursor = Boolean(after) || Boolean(stack);
  const result = await fetchCustomersPage({
    first,
    after,
    search,
    ...(segment ? { segmentId: segment } : {}),
  });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.customersPage.unauthorized}
      />
    );
  }
  if (result.outcome === "not_found") {
    // The segment was deleted (or never existed): say so, and offer the list without it, keeping the search.
    const clearSegment = new URLSearchParams();
    if (search) clearSegment.set("q", search);
    const queryString = clearSegment.toString();
    return (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={t.customersPage.segmentMissing}
      >
        <Button asChild variant="outline" size="sm">
          <Link href={queryString === "" ? "/customers" : `/customers?${queryString}`}>
            {t.customersPage.showAllCustomers}
          </Link>
        </Button>
      </StatePanel>
    );
  }
  if (result.outcome === "unavailable") {
    return (
      <StatePanel
        icon={<DatabaseIcon aria-hidden="true" className="size-5" />}
        message={t.segments.unavailable}
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
    // "No customers yet" is only true on the first, unfiltered page; a later empty page or a
    // filtered one says what actually happened.
    const message = hasFilters
      ? t.customersPage.emptyFiltered
      : hasCursor
        ? t.customersPage.emptyPage
        : t.customersPage.empty;
    return (
      <StatePanel
        icon={
          hasFilters || hasCursor ? (
            <SearchXIcon aria-hidden="true" className="size-5" />
          ) : (
            <UsersIcon aria-hidden="true" className="size-5" />
          )
        }
        message={message}
      >
        {hasCursor && <CustomersPagination hasNextPage={false} endCursor={null} t={t} />}
      </StatePanel>
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

function StatePanel({
  icon,
  message,
  children,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
        {icon}
        <p role="note">{message}</p>
        {children}
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
