import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import {
  fetchSecurityAnalytics,
  fetchSecurityDashboard,
  fetchTrustCenter,
  type SecurityAnalyticsDto,
  type SecurityDashboardDto,
  type TrustCenterDto,
} from "@/lib/api/security";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

interface OverviewPageProps {
  readonly searchParams: Promise<{ readonly tenantRef?: string }>;
}

/**
 * `/security` — the Security Console overview (T3.1): the dashboard, the Trust Center, and
 * security analytics. `AppShell` + the sub-nav + the tenant filter live in `security/layout.tsx`;
 * this page only renders the three console read models it owns.
 */
export default async function SecurityOverviewPage({ searchParams }: OverviewPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t.securityOverviewPage.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.securityOverviewPage.subtitle}</p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Suspense key={`dashboard:${params.tenantRef ?? ""}`} fallback={<CardSkeleton />}>
          <DashboardCard tenantRef={params.tenantRef} t={t} />
        </Suspense>
        <Suspense key={`trust:${params.tenantRef ?? ""}`} fallback={<CardSkeleton />}>
          <TrustCenterCard tenantRef={params.tenantRef} t={t} />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <AnalyticsCard t={t} />
        </Suspense>
      </div>
    </div>
  );
}

async function DashboardCard({
  tenantRef,
  t,
}: {
  readonly tenantRef: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchSecurityDashboard(tenantRef);
  if (result.outcome === "unauthorized") {
    return <StateCard title={t.securityOverviewPage.dashboardTitle} icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityOverviewPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StateCard title={t.securityOverviewPage.dashboardTitle} icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityOverviewPage.error} />;
  }
  const data: SecurityDashboardDto = result.data;
  const metricEntries = Object.entries(data.metrics);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityOverviewPage.dashboardTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3">
          <Stat label={t.securityOverviewPage.auditRecords} value={String(data.auditRecords)} />
          <div>
            <dt className="text-muted-foreground text-sm">{t.securityOverviewPage.chainValid}</dt>
            <dd className="mt-1">
              <Badge variant={data.chainValid ? "success" : "destructive"}>
                {data.chainValid ? t.securityOverviewPage.chainValid : t.securityOverviewPage.chainBroken}
              </Badge>
            </dd>
          </div>
        </dl>
        {metricEntries.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {metricEntries.map(([key, value]) => (
              <li key={key} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground truncate">{key}</span>
                <span className="font-medium tabular-nums">{value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t.securityOverviewPage.empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

async function TrustCenterCard({
  tenantRef,
  t,
}: {
  readonly tenantRef: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchTrustCenter(tenantRef);
  if (result.outcome === "unauthorized") {
    return <StateCard title={t.securityOverviewPage.trustCenterTitle} icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityOverviewPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StateCard title={t.securityOverviewPage.trustCenterTitle} icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityOverviewPage.error} />;
  }
  const data: TrustCenterDto = result.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityOverviewPage.trustCenterTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">{data.postureScore}</span>
          <span className="text-muted-foreground text-sm">{t.securityOverviewPage.postureScore}</span>
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <Stat label={t.securityOverviewPage.openIncidents} value={String(data.openIncidents)} />
          <Stat label={t.securityOverviewPage.criticalIncidents} value={String(data.criticalIncidents)} />
          <Stat label={t.securityOverviewPage.complianceControls} value={String(data.complianceControls)} />
          <div>
            <dt className="text-muted-foreground text-sm">{t.securityOverviewPage.chainValid}</dt>
            <dd className="mt-1">
              <Badge variant={data.auditChainValid ? "success" : "destructive"}>
                {data.auditChainValid ? t.securityOverviewPage.chainValid : t.securityOverviewPage.chainBroken}
              </Badge>
            </dd>
          </div>
        </dl>
        <div>
          <p className="text-muted-foreground text-sm">{t.securityOverviewPage.frameworksLabel}</p>
          {data.frameworks.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {data.frameworks.map((framework) => (
                <Badge key={framework} variant="neutral">
                  {framework}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">{t.securityOverviewPage.noFrameworks}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

async function AnalyticsCard({ t }: { readonly t: Dictionary }) {
  const result = await fetchSecurityAnalytics();
  if (result.outcome === "unauthorized") {
    return <StateCard title={t.securityOverviewPage.analyticsTitle} icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityOverviewPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StateCard title={t.securityOverviewPage.analyticsTitle} icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityOverviewPage.error} />;
  }
  const data: SecurityAnalyticsDto = result.data;
  const riskEntries = Object.entries(data.riskDistribution);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityOverviewPage.analyticsTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3">
          <Stat label={t.securityOverviewPage.loginSuccess} value={String(data.loginSuccess)} />
          <Stat label={t.securityOverviewPage.loginFailure} value={String(data.loginFailure)} />
          <Stat label={t.securityOverviewPage.mfaSuccess} value={String(data.mfaSuccess)} />
          <Stat label={t.securityOverviewPage.mfaFailure} value={String(data.mfaFailure)} />
          <Stat label={t.securityOverviewPage.accessAllowed} value={String(data.accessAllowed)} />
          <Stat label={t.securityOverviewPage.accessDenied} value={String(data.accessDenied)} />
          <Stat label={t.securityOverviewPage.accessChallenged} value={String(data.accessChallenged)} />
          <Stat label={t.securityOverviewPage.tokenRefreshed} value={String(data.tokenRefreshed)} />
          <Stat label={t.securityOverviewPage.threatsIndicated} value={String(data.threatsIndicated)} />
          <Stat label={t.securityOverviewPage.sessionsRevoked} value={String(data.sessionsRevoked)} />
        </dl>
        <div>
          <p className="text-muted-foreground text-sm">{t.securityOverviewPage.riskDistributionLabel}</p>
          {riskEntries.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {riskEntries.map(([band, count]) => (
                <li key={band} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{band}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">{t.securityOverviewPage.noRiskData}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function StateCard({
  title,
  icon,
  message,
}: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly message: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-base">
        {icon}
        <p role="note">{message}</p>
      </CardContent>
    </Card>
  );
}

function CardSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}
