import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import {
  AddIncidentEvidenceForm,
  CheckThreatIndicatorPanel,
  EvaluateCompliancePanel,
  IncidentLifecycleControl,
  OpenIncidentForm,
  RegisterComplianceRuleForm,
} from "@/components/security/audit-actions";
import { fetchAuditExplorer, fetchIncidentExplorer, verifyAuditChain } from "@/lib/api/security";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

interface AuditPageProps {
  readonly searchParams: Promise<{ readonly tenantRef?: string }>;
}

/**
 * `/security/audit` — audit explorer, incident explorer, and audit-chain verification (T3.1,
 * read-only). T5.12d adds the write controls: open incident, per-row incident lifecycle
 * (triage/mitigate/resolve/close, gated by `INCIDENT_NEXT_ACTIONS`), add evidence, check threat
 * indicator (simulation), evaluate compliance (simulation), and register compliance rule.
 */
export default async function SecurityAuditPage({ searchParams }: AuditPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t.securityAuditPage.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.securityAuditPage.subtitle}</p>
      </header>

      <Suspense key={`verify:${params.tenantRef ?? ""}`} fallback={<TableCardSkeleton />}>
        <VerifyAuditChainSection tenantRef={params.tenantRef} t={t} />
      </Suspense>

      <Suspense key={`audit:${params.tenantRef ?? ""}`} fallback={<TableCardSkeleton />}>
        <AuditExplorerSection tenantRef={params.tenantRef} t={t} />
      </Suspense>

      <Suspense fallback={<TableCardSkeleton />}>
        <IncidentExplorerSection t={t} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.securityAuditPage.openIncident.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <OpenIncidentForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.securityAuditPage.addEvidence.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <AddIncidentEvidenceForm t={t} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.securityAuditPage.checkThreatIndicator.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <CheckThreatIndicatorPanel t={t} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.securityAuditPage.evaluateCompliance.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <EvaluateCompliancePanel t={t} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.securityAuditPage.registerComplianceRule.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <RegisterComplianceRuleForm t={t} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function VerifyAuditChainSection({
  tenantRef,
  t,
}: {
  readonly tenantRef: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await verifyAuditChain(tenantRef);
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityAuditPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityAuditPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityAuditPage.verifyTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Badge variant={data.valid ? "success" : "destructive"} className="w-fit">
          {data.valid ? t.securityAuditPage.chainValid : t.securityAuditPage.chainBroken}
        </Badge>
        <p className="text-muted-foreground text-sm">
          {t.securityAuditPage.count}: {data.count}
        </p>
        {!data.valid && data.brokenAt !== undefined && (
          <p className="text-muted-foreground text-sm">
            {t.securityAuditPage.verifyBroken.replace("{brokenAt}", String(data.brokenAt))}
          </p>
        )}
        {data.reason !== undefined && (
          <p className="text-muted-foreground text-sm">
            {t.securityAuditPage.verifyReason.replace("{reason}", data.reason)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

async function AuditExplorerSection({
  tenantRef,
  t,
}: {
  readonly tenantRef: string | undefined;
  readonly t: Dictionary;
}) {
  const result = await fetchAuditExplorer(tenantRef);
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityAuditPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityAuditPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityAuditPage.auditTitle}</CardTitle>
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">
            {t.securityAuditPage.count}: <span className="text-foreground font-medium">{data.count}</span>
          </span>
          <Badge variant={data.chainValid ? "success" : "destructive"}>
            {data.chainValid ? t.securityAuditPage.chainValid : t.securityAuditPage.chainBroken}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {data.timeline.length === 0 ? (
          <p className="text-muted-foreground p-5 text-center text-base">{t.securityAuditPage.empty}</p>
        ) : (
          <Table aria-label={t.securityAuditPage.auditTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securityAuditPage.timelineColumns.sequence}</TableHead>
                <TableHead>{t.securityAuditPage.timelineColumns.principalRef}</TableHead>
                <TableHead>{t.securityAuditPage.timelineColumns.action}</TableHead>
                <TableHead>{t.securityAuditPage.timelineColumns.decision}</TableHead>
                <TableHead>{t.securityAuditPage.timelineColumns.resource}</TableHead>
                <TableHead>{t.securityAuditPage.timelineColumns.occurredAt}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.timeline.map((row) => (
                <TableRow key={row.sequence}>
                  <TableCell className="font-medium">{row.sequence}</TableCell>
                  <TableCell className="text-muted-foreground">{row.principalRef}</TableCell>
                  <TableCell className="text-muted-foreground">{row.action}</TableCell>
                  <TableCell>
                    <Badge variant="neutral">{row.decision}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.resource ?? t.securityAuditPage.noResource}</TableCell>
                  <TableCell className="text-muted-foreground">{row.occurredAt}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function IncidentExplorerSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchIncidentExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityAuditPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityAuditPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityAuditPage.incidentsTitle}</CardTitle>
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">
            {t.securityAuditPage.total}: <span className="text-foreground font-medium">{data.total}</span>
          </span>
          <span className="text-muted-foreground">
            {t.securityAuditPage.open}: <span className="text-foreground font-medium">{data.open}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {data.incidents.length === 0 ? (
          <p className="text-muted-foreground p-5 text-center text-base">{t.securityAuditPage.empty}</p>
        ) : (
          <Table aria-label={t.securityAuditPage.incidentsTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securityAuditPage.incidentColumns.reference}</TableHead>
                <TableHead>{t.securityAuditPage.incidentColumns.title}</TableHead>
                <TableHead>{t.securityAuditPage.incidentColumns.severity}</TableHead>
                <TableHead>{t.securityAuditPage.incidentColumns.status}</TableHead>
                <TableHead>{t.securityAuditPage.incidentColumns.category}</TableHead>
                <TableHead>{t.securityAuditPage.incidentColumns.assignee}</TableHead>
                <TableHead>{t.securityAuditPage.incidentColumns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.incidents.map((incident) => (
                <TableRow key={incident.reference}>
                  <TableCell className="font-medium">{incident.reference}</TableCell>
                  <TableCell>{incident.title}</TableCell>
                  <TableCell>
                    <Badge variant={incident.severity === "critical" || incident.severity === "high" ? "destructive" : "neutral"}>
                      {incident.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{incident.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{incident.category}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {incident.assignee ?? t.securityAuditPage.unassigned}
                  </TableCell>
                  <TableCell>
                    <IncidentLifecycleControl reference={incident.reference} status={incident.status} t={t} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
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

function TableCardSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}
