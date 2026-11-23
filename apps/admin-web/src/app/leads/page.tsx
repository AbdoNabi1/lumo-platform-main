import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, DownloadIcon, InboxIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { LeadsPagination } from "@/components/leads/leads-pagination";
import { LeadsTable } from "@/components/leads/leads-table";
import { LeadsToolbar } from "@/components/leads/leads-toolbar";
import { fetchLeadsPage } from "@/lib/api/leads";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { isLeadStatus, type LeadStatus } from "@/lib/leads/lead-status";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;
/** The API refuses a longer search with a 422. */
const SEARCH_MAX_LENGTH = 100;
const EXPORT_ERRORS = ["forbidden", "invalid", "too_many", "failed"] as const;

interface LeadsPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly status?: string;
    readonly after?: string;
    readonly stack?: string;
    readonly exportError?: string;
  }>;
}

/**
 * The Leads inbox (Lead Site Part C): people who left their details in a lead site's form. A server
 * component: search and status live in the URL (`?q=&status=&after=&stack=`, driven by the client
 * `LeadsToolbar`/`LeadsPagination`), so every state survives a refresh and the back button. The
 * chrome renders at once; only the results resolve inside their own `<Suspense>`. "Export CSV" is
 * offered to operators and admins only — the `leads:export` permission a viewer lacks.
 */
export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;
  const session = await readSession();
  const role = highestRole(session?.roles ?? []);
  const canExport = role === "admin" || role === "operator";

  const status = isLeadStatus(params.status) ? params.status : undefined;
  const search = params.q?.trim().slice(0, SEARCH_MAX_LENGTH) ?? "";
  const exportError = EXPORT_ERRORS.find((error) => error === params.exportError);
  const exportHref = status === undefined ? "/leads/export" : `/leads/export?status=${status}`;

  return (
    <AppShell t={t} locale={locale} activeNavId="leads" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t.leadsPage.title}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t.leadsPage.subtitle}</p>
          </div>
          {canExport && (
            <Button variant="outline" asChild>
              <a href={exportHref}>
                <DownloadIcon aria-hidden="true" />
                {t.leadsPage.exportCsv}
              </a>
            </Button>
          )}
        </header>

        <LeadsToolbar t={t} />

        {exportError !== undefined && (
          <p
            role="alert"
            className="bg-warning-subtle text-warning-foreground rounded-2xl px-4 py-3 text-base"
          >
            {t.leadsExport.errors[exportError]}
          </p>
        )}

        <Suspense
          key={`${search}:${status ?? ""}:${params.after ?? ""}`}
          fallback={<LeadsTableSkeleton />}
        >
          <LeadsResults
            first={PAGE_SIZE}
            after={params.after}
            status={status}
            search={search}
            t={t}
            locale={locale}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function LeadsResults({
  first,
  after,
  status,
  search,
  t,
  locale,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly status: LeadStatus | undefined;
  readonly search: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const result = await fetchLeadsPage({
    first,
    ...(after === undefined ? {} : { after }),
    ...(status === undefined ? {} : { status }),
    ...(search.length === 0 ? {} : { search }),
  });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.leadsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.leadsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    const filtered = status !== undefined || search.length > 0;
    return (
      <StatePanel
        icon={
          filtered ? (
            <SearchXIcon aria-hidden="true" className="size-5" />
          ) : (
            <InboxIcon aria-hidden="true" className="size-5" />
          )
        }
        message={filtered ? t.leadsPage.emptyFiltered : t.leadsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <LeadsTable leads={result.items} t={t} locale={locale} />
      </CardContent>
      <div className="border-border flex items-center justify-end border-t px-4 py-3 sm:px-5">
        <LeadsPagination
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

function LeadsTableSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-0 sm:p-0">
        <div className="flex flex-col">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="border-border flex items-center gap-4 border-t px-4 py-3 first:border-t-0 sm:px-5"
            >
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ms-auto h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
