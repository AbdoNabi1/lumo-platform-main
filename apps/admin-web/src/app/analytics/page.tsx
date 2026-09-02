import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, BarChart3Icon, LockIcon } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import {
  fetchAnalyticsDimensions,
  fetchAnalyticsMetrics,
  type AnalyticsDimensionDto,
  type AnalyticsMetricDto,
  type FetchAnalyticsDimensionsResult,
  type FetchAnalyticsMetricsResult,
} from "@/lib/api/analytics";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * The Analytics screen (Phase A.30, rewired Phase 0 T0.6). `services/analytics` only catalogs
 * metric/dimension *definitions* — its own controller doc comment explains why a query-execution
 * endpoint isn't built there (no populated `AnalyticsReadStore`, no CDC pipeline). Rather than
 * render nothing while that gap exists, this screen is a metric-catalog explorer over the four
 * read endpoints that already are wired (`GET /analytics/metrics(/:id)`,
 * `GET /analytics/dimensions(/:id)`) and says plainly, in `t.analyticsPage.queryNote`, that running
 * a query is a separate, unconnected capability — the same "never fake it" discipline as the
 * Dashboard's `data.demoBadge` disclosure, but honest about "catalog only" instead of a blank page.
 */
export default async function AnalyticsPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  const [metrics, dimensions] = await Promise.all([
    fetchAnalyticsMetrics(),
    fetchAnalyticsDimensions(),
  ]);

  return (
    <AppShell t={t} locale={locale} activeNavId="analytics" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <h1 className="text-4xl font-semibold tracking-tight">{t.analyticsPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.analyticsPage.subtitle}</p>
        </header>

        <MetricsCard result={metrics} t={t} />
        <DimensionsCard result={dimensions} t={t} />

        <p className="text-muted-foreground text-sm">{t.analyticsPage.queryNote}</p>
      </div>
    </AppShell>
  );
}

function MetricsCard({
  result,
  t,
}: {
  readonly result: FetchAnalyticsMetricsResult;
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.analyticsPage.metricsTitle}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        <AnalyticsBody result={result} t={t}>
          {(items: readonly AnalyticsMetricDto[]) => (
            <Table aria-label={t.analyticsPage.metricsTitle}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.analyticsPage.columns.id}</TableHead>
                  <TableHead>{t.analyticsPage.columns.description}</TableHead>
                  <TableHead>{t.analyticsPage.columns.kind}</TableHead>
                  <TableHead>{t.analyticsPage.columns.unit}</TableHead>
                  <TableHead>{t.analyticsPage.columns.aggregation}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((metric) => (
                  <TableRow key={metric.id}>
                    <TableCell className="font-medium">{metric.id}</TableCell>
                    <TableCell className="text-muted-foreground">{metric.description}</TableCell>
                    <TableCell>
                      <Badge variant={metric.kind === "definition" ? "success" : "neutral"}>
                        {metric.kind === "definition"
                          ? t.analyticsPage.kindDefinition
                          : t.analyticsPage.kindCalculated}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{metric.unit}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {metric.measure?.aggregation ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AnalyticsBody>
      </CardContent>
    </Card>
  );
}

function DimensionsCard({
  result,
  t,
}: {
  readonly result: FetchAnalyticsDimensionsResult;
  readonly t: Dictionary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.analyticsPage.dimensionsTitle}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        <AnalyticsBody result={result} t={t}>
          {(items: readonly AnalyticsDimensionDto[]) => (
            <Table aria-label={t.analyticsPage.dimensionsTitle}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.analyticsPage.columns.id}</TableHead>
                  <TableHead>{t.analyticsPage.columns.label}</TableHead>
                  <TableHead>{t.analyticsPage.columns.readModel}</TableHead>
                  <TableHead>{t.analyticsPage.columns.field}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((dimension) => (
                  <TableRow key={dimension.id}>
                    <TableCell className="font-medium">{dimension.id}</TableCell>
                    <TableCell className="text-muted-foreground">{dimension.label}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {dimension.readModelId}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dimension.physicalField}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AnalyticsBody>
      </CardContent>
    </Card>
  );
}

/** Handles all four `ApiResult` outcomes the same way `content/page.tsx` does — an error never renders as an empty list. */
function AnalyticsBody<TItem>({
  result,
  t,
  children,
}: {
  readonly result:
    | { readonly outcome: "ok"; readonly items: readonly TItem[] }
    | { readonly outcome: "unauthorized" }
    | { readonly outcome: "error"; readonly message: string };
  readonly t: Dictionary;
  readonly children: (items: readonly TItem[]) => ReactNode;
}) {
  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.analyticsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.analyticsPage.error}
      />
    );
  }
  if (result.items.length === 0) {
    return (
      <StatePanel
        icon={<BarChart3Icon aria-hidden="true" className="size-5" />}
        message={t.analyticsPage.empty}
      />
    );
  }
  return <>{children(result.items)}</>;
}

function StatePanel({ icon, message }: { readonly icon: ReactNode; readonly message: string }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-16 text-center text-base sm:px-5">
      {icon}
      <p role="note">{message}</p>
    </div>
  );
}
