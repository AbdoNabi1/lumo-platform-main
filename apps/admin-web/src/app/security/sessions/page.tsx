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
import { SecurityLookupForm } from "@/components/security/security-lookup-form";
import {
  AuthenticatePanel,
  BlockDeviceRowForm,
  DecideMfaPanel,
  EnrollMfaForm,
  EstablishSessionForm,
  EvaluateRiskPanel,
  GenerateBackupCodesPanel,
  RecordDeviceSignalRowForm,
  RefreshSessionRowForm,
  RegisterAuthMethodForm,
  RegisterDeviceForm,
  RegisterMfaMethodForm,
  RevokeAllSessionsForm,
  RevokeMfaForm,
  RevokeSessionRowForm,
  TrustDeviceRowForm,
  VerifyMfaEnrollmentForm,
} from "@/components/security/sessions-actions";
import {
  fetchDeviceExplorer,
  fetchRiskExplorer,
  fetchSessionExplorer,
  introspectSession,
} from "@/lib/api/security";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

interface SessionsPageProps {
  readonly searchParams: Promise<{ readonly sessionId?: string }>;
}

/**
 * `/security/sessions` — session, device, and risk explorers, plus the session introspect lookup
 * (T3.1, read-only). T5.12e adds the plan's named "session revocation" high-blast-radius write
 * controls, organized into 5 sub-sections matching the task brief's own grouping: Sessions
 * (establish/refresh/revoke/revoke-all — the literal "session revocation" controls), Auth Methods &
 * Authenticate (register-method + the authenticate() "try it" panel), Devices (register + per-row
 * signal/trust/block), MFA (enroll/verify/backup-codes/revoke/decide/register-method — none of
 * which have a console explorer on this page, so every MFA form takes a manually-typed id), and
 * Risk (the risk-evaluate "try it" panel). Session refresh/revoke and device signal/trust/block
 * attach as per-row controls — `SessionRowDto`/`DeviceExplorerRowDto` were checked fresh for this
 * part and do expose `id`/`fingerprint` per row, unlike the id-less explorers T5.12a-c's own write
 * parts document.
 */
export default async function SecuritySessionsPage({ searchParams }: SessionsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t.securitySessionsPage.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.securitySessionsPage.subtitle}</p>
      </header>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t.securitySessionsPage.sections.sessions}</h2>

        <Suspense fallback={<TableCardSkeleton />}>
          <SessionExplorerSection t={t} />
        </Suspense>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.establishSession.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <EstablishSessionForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.revokeAllSessions.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <RevokeAllSessionsForm t={t} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <SecurityLookupForm
            title={t.securitySessionsPage.lookups.introspect.title}
            submitLabel={t.securityLookup.submit}
            fields={[
              {
                name: "sessionId",
                label: t.securitySessionsPage.lookups.introspect.fieldLabel,
                defaultValue: params.sessionId,
              },
            ]}
          />
          {params.sessionId !== undefined && params.sessionId.length > 0 && (
            <Suspense key={params.sessionId} fallback={<ResultSkeleton />}>
              <IntrospectSessionResult sessionId={params.sessionId} t={t} />
            </Suspense>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t.securitySessionsPage.sections.authMethods}
        </h2>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.registerAuthMethod.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <RegisterAuthMethodForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.authenticate.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <AuthenticatePanel t={t} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t.securitySessionsPage.sections.devices}</h2>

        <Suspense fallback={<TableCardSkeleton />}>
          <DeviceExplorerSection t={t} />
        </Suspense>

        <Card>
          <CardHeader>
            <CardTitle>{t.securitySessionsPage.registerDevice.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <RegisterDeviceForm t={t} />
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t.securitySessionsPage.sections.mfa}</h2>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.enrollMfa.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <EnrollMfaForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.verifyMfa.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <VerifyMfaEnrollmentForm t={t} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.generateBackupCodes.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <GenerateBackupCodesPanel t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.revokeMfa.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <RevokeMfaForm t={t} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.registerMfaMethod.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <RegisterMfaMethodForm t={t} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t.securitySessionsPage.decideMfa.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <DecideMfaPanel t={t} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t.securitySessionsPage.sections.risk}</h2>

        <Suspense fallback={<TableCardSkeleton />}>
          <RiskExplorerSection t={t} />
        </Suspense>

        <Card>
          <CardHeader>
            <CardTitle>{t.securitySessionsPage.evaluateRisk.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <EvaluateRiskPanel t={t} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

async function SessionExplorerSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchSessionExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securitySessionsPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securitySessionsPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securitySessionsPage.sessionsTitle}</CardTitle>
        <div className="flex flex-wrap gap-4 text-sm">
          <Stat label={t.securitySessionsPage.total} value={data.total} />
          <Stat label={t.securitySessionsPage.active} value={data.active} />
          <Stat label={t.securitySessionsPage.revoked} value={data.revoked} />
          <Stat label={t.securitySessionsPage.expired} value={data.expired} />
          <Stat label={t.securitySessionsPage.impersonations} value={data.impersonations} />
          <Stat label={t.securitySessionsPage.suspicious} value={data.suspicious} />
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {data.sessions.length === 0 ? (
          <p className="text-muted-foreground p-5 text-center text-base">{t.securitySessionsPage.empty}</p>
        ) : (
          <Table aria-label={t.securitySessionsPage.sessionsTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securitySessionsPage.sessionColumns.id}</TableHead>
                <TableHead>{t.securitySessionsPage.sessionColumns.principalRef}</TableHead>
                <TableHead>{t.securitySessionsPage.sessionColumns.status}</TableHead>
                <TableHead>{t.securitySessionsPage.sessionColumns.refreshCount}</TableHead>
                <TableHead>{t.securitySessionsPage.sessionColumns.risk}</TableHead>
                <TableHead>{t.securitySessionsPage.sessionColumns.expiresAt}</TableHead>
                <TableHead>{t.securitySessionsPage.sessionColumns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">{session.id}</TableCell>
                  <TableCell className="text-muted-foreground">{session.principalRef}</TableCell>
                  <TableCell>
                    <Badge variant={session.suspicious ? "warning" : "neutral"}>{session.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{session.refreshCount}</TableCell>
                  <TableCell className="text-muted-foreground">{session.riskAtLastEval}</TableCell>
                  <TableCell className="text-muted-foreground">{session.expiresAt}</TableCell>
                  <TableCell>
                    {session.status === "active" ? (
                      <div className="flex flex-col gap-2">
                        <RefreshSessionRowForm sessionId={session.id} t={t} />
                        <RevokeSessionRowForm sessionId={session.id} t={t} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {t.securitySessionsPage.sessionActions.terminal}
                      </span>
                    )}
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

async function DeviceExplorerSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchDeviceExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securitySessionsPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securitySessionsPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securitySessionsPage.devicesTitle}</CardTitle>
        <div className="flex flex-wrap gap-4 text-sm">
          <Stat label={t.securitySessionsPage.total} value={data.total} />
          <Stat label={t.securitySessionsPage.trusted} value={data.trusted} />
          <Stat label={t.securitySessionsPage.blocked} value={data.blocked} />
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {data.devices.length === 0 ? (
          <p className="text-muted-foreground p-5 text-center text-base">{t.securitySessionsPage.empty}</p>
        ) : (
          <Table aria-label={t.securitySessionsPage.devicesTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securitySessionsPage.deviceColumns.fingerprint}</TableHead>
                <TableHead>{t.securitySessionsPage.deviceColumns.principalRef}</TableHead>
                <TableHead>{t.securitySessionsPage.deviceColumns.trustLevel}</TableHead>
                <TableHead>{t.securitySessionsPage.deviceColumns.reputation}</TableHead>
                <TableHead>{t.securitySessionsPage.deviceColumns.anomalyCount}</TableHead>
                <TableHead>{t.securitySessionsPage.deviceColumns.lastSeenAt}</TableHead>
                <TableHead>{t.securitySessionsPage.deviceColumns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.devices.map((device) => (
                <TableRow key={device.fingerprint}>
                  <TableCell className="font-medium">{device.fingerprint}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {device.principalRef ?? t.securitySessionsPage.noPrincipal}
                  </TableCell>
                  <TableCell>
                    <Badge variant={device.trustLevel === "blocked" ? "destructive" : device.trustLevel === "trusted" ? "success" : "neutral"}>
                      {device.trustLevel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{device.reputation}</TableCell>
                  <TableCell className="text-muted-foreground">{device.anomalyCount}</TableCell>
                  <TableCell className="text-muted-foreground">{device.lastSeenAt}</TableCell>
                  <TableCell>
                    {device.trustLevel === "blocked" ? (
                      <span className="text-muted-foreground text-xs">
                        {t.securitySessionsPage.deviceActions.terminal}
                      </span>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <RecordDeviceSignalRowForm fingerprint={device.fingerprint} t={t} />
                        {device.trustLevel !== "trusted" && (
                          <TrustDeviceRowForm fingerprint={device.fingerprint} t={t} />
                        )}
                        <BlockDeviceRowForm fingerprint={device.fingerprint} t={t} />
                      </div>
                    )}
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

async function RiskExplorerSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchRiskExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securitySessionsPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securitySessionsPage.error} />;
  }
  const { data } = result;
  const entries = Object.entries(data.distribution);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securitySessionsPage.riskTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-muted-foreground text-sm">{t.securitySessionsPage.total}</dt>
            <dd className="font-medium tabular-nums">{data.total}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">{t.securitySessionsPage.dominantBand}</dt>
            <dd className="font-medium">{data.dominantBand ?? t.securitySessionsPage.noDominantBand}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">{t.securitySessionsPage.threatsIndicated}</dt>
            <dd className="font-medium tabular-nums">{data.threatsIndicated}</dd>
          </div>
        </dl>
        <div>
          <p className="text-muted-foreground text-sm">{t.securitySessionsPage.riskDistributionLabel}</p>
          {entries.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">{t.securitySessionsPage.empty}</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {entries.map(([band, count]) => (
                <li key={band} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{band}</span>
                  <span className="font-medium tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

async function IntrospectSessionResult({
  sessionId,
  t,
}: {
  readonly sessionId: string;
  readonly t: Dictionary;
}) {
  const result = await introspectSession(sessionId);
  if (result.outcome === "unauthorized") return <ResultPanel message={t.securityLookup.unauthorized} />;
  if (result.outcome === "error") return <ResultPanel message={t.securityLookup.error} />;
  const { data } = result;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-5 text-sm">
        <Badge variant={data.active ? "success" : "destructive"}>
          {data.active ? t.securitySessionsPage.sessionActive : t.securitySessionsPage.sessionInactive}
        </Badge>
        {data.session !== null && (
          <div className="text-muted-foreground">
            <p>{data.session.principalRef}</p>
            <p>{data.session.status}</p>
            <p>{data.session.expiresAt}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <span className="text-muted-foreground">
      {label}: <span className="text-foreground font-medium tabular-nums">{value}</span>
    </span>
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

function ResultPanel({ message }: { readonly message: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground pt-5 text-sm">
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

function ResultSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="flex flex-col gap-2 pt-5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}
