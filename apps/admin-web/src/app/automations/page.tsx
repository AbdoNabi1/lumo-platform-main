import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon, WorkflowIcon } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { AutomationsPagination } from "@/components/automations/automations-pagination";
import { fetchWorkflowsPage, type WorkflowExecutionDto } from "@/lib/api/automations";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const PAGE_SIZE = 20;

const STATUS_VARIANT: Readonly<Record<string, "neutral" | "success" | "warning" | "outline">> = {
  draft: "neutral",
  active: "success",
  paused: "warning",
  archived: "outline",
};

const EXECUTION_VARIANT: Readonly<
  Record<string, "neutral" | "info" | "success" | "destructive" | "warning">
> = {
  pending: "neutral",
  running: "info",
  succeeded: "success",
  failed: "destructive",
  retrying: "warning",
  dead_letter: "destructive",
};

interface AutomationsPageProps {
  readonly searchParams: Promise<{ readonly after?: string }>;
}

/**
 * The Automations screen (Phase A.30), backed by `GET /automation/workflows` (Automation had
 * create/advance/trigger/retry mutations but no read route at all before this). "Last execution"
 * is real, persisted data from the workflow's own append-only execution log — shown only when at
 * least one execution has actually run.
 */
export default async function AutomationsPage({ searchParams }: AutomationsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;

  return (
    <AppShell t={t} locale={locale} activeNavId="automations" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight">{t.automationsPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.automationsPage.subtitle}</p>
        </header>

        <Suspense key={params.after ?? ""} fallback={<AutomationsTableSkeleton />}>
          <AutomationsResults first={PAGE_SIZE} after={params.after} t={t} locale={locale} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function AutomationsResults({
  first,
  after,
  t,
  locale,
}: {
  readonly first: number;
  readonly after: string | undefined;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const result = await fetchWorkflowsPage({ first, after });

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.automationsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.automationsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<WorkflowIcon aria-hidden="true" className="size-5" />}
        message={t.automationsPage.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <Table aria-label={t.automationsPage.title}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.automationsPage.columns.name}</TableHead>
              <TableHead>{t.automationsPage.columns.status}</TableHead>
              <TableHead>{t.automationsPage.columns.trigger}</TableHead>
              <TableHead>{t.automationsPage.columns.lastExecution}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((workflow) => (
              <TableRow key={workflow.id}>
                <TableCell className="font-medium">{workflow.name}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[workflow.status] ?? "neutral"}>
                    {(t.automationStatus as Record<string, string>)[workflow.status] ??
                      workflow.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {workflow.triggerType === "event"
                    ? t.automationsPage.triggerEvent.replace(
                        "{eventType}",
                        workflow.eventType ?? "",
                      )
                    : t.automationsPage.triggerScheduled.replace(
                        "{cronExpression}",
                        workflow.cronExpression ?? "",
                      )}
                </TableCell>
                <TableCell className="text-sm">
                  <LastExecutionCell execution={workflow.lastExecution} t={t} locale={locale} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <div className="border-border flex items-center justify-between border-t px-4 py-3 sm:px-5">
        <AutomationsPagination
          hasNextPage={result.pageInfo.hasNextPage}
          endCursor={result.pageInfo.endCursor}
          t={t}
        />
      </div>
    </Card>
  );
}

function LastExecutionCell({
  execution,
  t,
  locale,
}: {
  readonly execution: WorkflowExecutionDto | null;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  if (execution === null) {
    return <span className="text-muted-foreground">{t.automationsPage.neverRun}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <Badge variant={EXECUTION_VARIANT[execution.status] ?? "neutral"}>
        {(t.executionStatus as Record<string, string>)[execution.status] ?? execution.status}
      </Badge>
      <span className="text-muted-foreground">{formatDateTime(locale, execution.startedAt)}</span>
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

function AutomationsTableSkeleton() {
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
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
