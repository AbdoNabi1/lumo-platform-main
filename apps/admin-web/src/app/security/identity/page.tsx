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
  GovernMachineIdentityForm,
  IssueCredentialForm,
  RegisterPrincipalForm,
  RevokeCredentialForm,
  RotateCredentialForm,
  SuspendMachineIdentityForm,
  TransitionPrincipalControl,
} from "@/components/security/identity-actions";
import { SecurityLookupForm } from "@/components/security/security-lookup-form";
import {
  checkConsent,
  fetchIdentityOverview,
  fetchMachineIdentityExplorer,
  resolveMachineIdentity,
  resolveMembership,
  resolveOrganization,
  resolvePrincipal,
} from "@/lib/api/security";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

interface IdentityPageProps {
  readonly searchParams: Promise<{
    readonly subjectRef?: string;
    readonly userId?: string;
    readonly organizationId?: string;
    readonly machineExternalId?: string;
    readonly consentSubjectRef?: string;
    readonly consentPurpose?: string;
  }>;
}

/** `/security/identity` — identity overview, machine-identity explorer, and 5 identity resolution lookups (T3.1). */
export default async function SecurityIdentityPage({ searchParams }: IdentityPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t.securityIdentityPage.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.securityIdentityPage.subtitle}</p>
      </header>

      <Suspense fallback={<TableCardSkeleton />}>
        <IdentityOverviewSection t={t} />
      </Suspense>

      <Suspense fallback={<TableCardSkeleton />}>
        <MachineIdentitySection t={t} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.securityIdentityPage.register.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <RegisterPrincipalForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.securityIdentityPage.governMachine.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <GovernMachineIdentityForm t={t} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.securityIdentityPage.suspendMachine.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <SuspendMachineIdentityForm t={t} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.securityIdentityPage.issueCredential.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <IssueCredentialForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.securityIdentityPage.rotateCredential.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <RotateCredentialForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.securityIdentityPage.revokeCredential.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <RevokeCredentialForm t={t} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <SecurityLookupForm
            title={t.securityIdentityPage.lookups.principal.title}
            submitLabel={t.securityLookup.submit}
            fields={[
              {
                name: "subjectRef",
                label: t.securityIdentityPage.lookups.principal.fieldLabel,
                defaultValue: params.subjectRef,
              },
            ]}
          />
          {params.subjectRef !== undefined && params.subjectRef.length > 0 && (
            <Suspense key={params.subjectRef} fallback={<ResultSkeleton />}>
              <ResolvePrincipalResult subjectRef={params.subjectRef} t={t} />
            </Suspense>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <SecurityLookupForm
            title={t.securityIdentityPage.lookups.membership.title}
            submitLabel={t.securityLookup.submit}
            fields={[
              {
                name: "userId",
                label: t.securityIdentityPage.lookups.membership.fieldLabel,
                defaultValue: params.userId,
              },
            ]}
          />
          {params.userId !== undefined && params.userId.length > 0 && (
            <Suspense key={params.userId} fallback={<ResultSkeleton />}>
              <ResolveMembershipResult userId={params.userId} t={t} />
            </Suspense>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <SecurityLookupForm
            title={t.securityIdentityPage.lookups.organization.title}
            submitLabel={t.securityLookup.submit}
            fields={[
              {
                name: "organizationId",
                label: t.securityIdentityPage.lookups.organization.fieldLabel,
                defaultValue: params.organizationId,
              },
            ]}
          />
          {params.organizationId !== undefined && params.organizationId.length > 0 && (
            <Suspense key={params.organizationId} fallback={<ResultSkeleton />}>
              <ResolveOrganizationResult organizationId={params.organizationId} t={t} />
            </Suspense>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <SecurityLookupForm
            title={t.securityIdentityPage.lookups.machineIdentity.title}
            submitLabel={t.securityLookup.submit}
            fields={[
              {
                name: "machineExternalId",
                label: t.securityIdentityPage.lookups.machineIdentity.fieldLabel,
                defaultValue: params.machineExternalId,
              },
            ]}
          />
          {params.machineExternalId !== undefined && params.machineExternalId.length > 0 && (
            <Suspense key={params.machineExternalId} fallback={<ResultSkeleton />}>
              <ResolveMachineIdentityResult externalId={params.machineExternalId} t={t} />
            </Suspense>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <SecurityLookupForm
            title={t.securityIdentityPage.lookups.consent.title}
            submitLabel={t.securityLookup.submit}
            fields={[
              {
                name: "consentSubjectRef",
                label: t.securityIdentityPage.lookups.consent.subjectFieldLabel,
                defaultValue: params.consentSubjectRef,
              },
              {
                name: "consentPurpose",
                label: t.securityIdentityPage.lookups.consent.purposeFieldLabel,
                defaultValue: params.consentPurpose,
              },
            ]}
          />
          {params.consentSubjectRef !== undefined &&
            params.consentSubjectRef.length > 0 &&
            params.consentPurpose !== undefined &&
            params.consentPurpose.length > 0 && (
              <Suspense key={`${params.consentSubjectRef}:${params.consentPurpose}`} fallback={<ResultSkeleton />}>
                <CheckConsentResult
                  subjectRef={params.consentSubjectRef}
                  purpose={params.consentPurpose}
                  t={t}
                />
              </Suspense>
            )}
        </div>
      </div>
    </div>
  );
}

async function IdentityOverviewSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchIdentityOverview();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityIdentityPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityIdentityPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityIdentityPage.overviewTitle}</CardTitle>
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">
            {t.securityIdentityPage.totalPrincipals}: <span className="text-foreground font-medium">{data.total}</span>
          </span>
          <span className="text-muted-foreground">
            {t.securityIdentityPage.humans}: <span className="text-foreground font-medium">{data.humans}</span>
          </span>
          <span className="text-muted-foreground">
            {t.securityIdentityPage.nonHumans}: <span className="text-foreground font-medium">{data.nonHumans}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {data.principals.length === 0 ? (
          <p className="text-muted-foreground p-5 text-center text-base">{t.securityIdentityPage.empty}</p>
        ) : (
          <Table aria-label={t.securityIdentityPage.overviewTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securityIdentityPage.columns.externalId}</TableHead>
                <TableHead>{t.securityIdentityPage.columns.kind}</TableHead>
                <TableHead>{t.securityIdentityPage.columns.status}</TableHead>
                <TableHead>{t.securityIdentityPage.columns.tenant}</TableHead>
                <TableHead>{t.securityIdentityPage.columns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.principals.map((principal) => (
                <TableRow key={principal.externalId}>
                  <TableCell className="font-medium">{principal.externalId}</TableCell>
                  <TableCell className="text-muted-foreground">{principal.kind}</TableCell>
                  <TableCell>
                    <Badge variant="neutral">{principal.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {principal.tenantRef ?? t.securityIdentityPage.noTenant}
                  </TableCell>
                  <TableCell>
                    <TransitionPrincipalControl
                      externalId={principal.externalId}
                      status={principal.status}
                      t={t}
                    />
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

async function MachineIdentitySection({ t }: { readonly t: Dictionary }) {
  const result = await fetchMachineIdentityExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityIdentityPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityIdentityPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityIdentityPage.machineTitle}</CardTitle>
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">
            {t.securityIdentityPage.active}: <span className="text-foreground font-medium">{data.active}</span>
          </span>
          <span className="text-muted-foreground">
            {t.securityIdentityPage.suspended}: <span className="text-foreground font-medium">{data.suspended}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {data.identities.length === 0 ? (
          <p className="text-muted-foreground p-5 text-center text-base">{t.securityIdentityPage.empty}</p>
        ) : (
          <Table aria-label={t.securityIdentityPage.machineTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securityIdentityPage.machineColumns.principalRef}</TableHead>
                <TableHead>{t.securityIdentityPage.machineColumns.owner}</TableHead>
                <TableHead>{t.securityIdentityPage.machineColumns.purpose}</TableHead>
                <TableHead>{t.securityIdentityPage.machineColumns.status}</TableHead>
                <TableHead>{t.securityIdentityPage.machineColumns.allowedScopes}</TableHead>
                <TableHead>{t.securityIdentityPage.machineColumns.rotationInterval}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.identities.map((identity) => (
                <TableRow key={identity.principalRef}>
                  <TableCell className="font-medium">{identity.principalRef}</TableCell>
                  <TableCell className="text-muted-foreground">{identity.owner}</TableCell>
                  <TableCell className="text-muted-foreground">{identity.purpose}</TableCell>
                  <TableCell>
                    <Badge variant="neutral">{identity.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{identity.allowedScopeCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {identity.rotationIntervalDays ?? t.securityIdentityPage.noRotationPolicy}
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

async function ResolvePrincipalResult({
  subjectRef,
  t,
}: {
  readonly subjectRef: string;
  readonly t: Dictionary;
}) {
  const result = await resolvePrincipal(subjectRef);
  if (result.outcome === "unauthorized") return <ResultPanel message={t.securityLookup.unauthorized} />;
  if (result.outcome === "error") return <ResultPanel message={t.securityLookup.error} />;
  const { data } = result;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div>
          <p className="text-muted-foreground text-sm">{t.securityIdentityPage.resolvedPrincipal}</p>
          {data.principal === null ? (
            <p className="text-muted-foreground text-sm">{t.securityIdentityPage.noPrincipalFound}</p>
          ) : (
            <p className="text-sm">
              {data.principal.externalId} — {data.principal.kind} — <Badge variant="neutral">{data.principal.status}</Badge>
            </p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground text-sm">{t.securityIdentityPage.resolvedIdentityUser}</p>
          {data.identityUser === null ? (
            <p className="text-muted-foreground text-sm">{t.securityIdentityPage.noIdentityUserFound}</p>
          ) : (
            <p className="text-sm">
              {data.identityUser.userId} — <Badge variant="neutral">{data.identityUser.status}</Badge>
            </p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground text-sm">{t.securityIdentityPage.resolvedMemberships}</p>
          {data.memberships.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.securityIdentityPage.noMemberships}</p>
          ) : (
            <ul className="text-sm">
              {data.memberships.map((m) => (
                <li key={m.membershipId}>
                  {m.organizationSlug ?? m.organizationId} — {m.role}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

async function ResolveMembershipResult({ userId, t }: { readonly userId: string; readonly t: Dictionary }) {
  const result = await resolveMembership(userId);
  if (result.outcome === "unauthorized") return <ResultPanel message={t.securityLookup.unauthorized} />;
  if (result.outcome === "error") return <ResultPanel message={t.securityLookup.error} />;
  const { data } = result;
  return (
    <Card>
      <CardContent className="pt-5">
        {data.memberships.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.securityIdentityPage.noMemberships}</p>
        ) : (
          <ul className="text-sm">
            {data.memberships.map((m) => (
              <li key={m.membershipId}>
                {m.organizationSlug ?? m.organizationId} — {m.role}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function ResolveOrganizationResult({
  organizationId,
  t,
}: {
  readonly organizationId: string;
  readonly t: Dictionary;
}) {
  const result = await resolveOrganization(organizationId);
  if (result.outcome === "unauthorized") return <ResultPanel message={t.securityLookup.unauthorized} />;
  if (result.outcome === "not_found") return <ResultPanel message={t.securityLookup.notFound} />;
  if (result.outcome === "error") return <ResultPanel message={t.securityLookup.error} />;
  const { data } = result;
  return (
    <Card>
      <CardContent className="pt-5 text-sm">
        <p>{data.slug}</p>
        <p className="text-muted-foreground">{data.tenant ?? t.securityIdentityPage.noTenant}</p>
      </CardContent>
    </Card>
  );
}

async function ResolveMachineIdentityResult({
  externalId,
  t,
}: {
  readonly externalId: string;
  readonly t: Dictionary;
}) {
  const result = await resolveMachineIdentity(externalId);
  if (result.outcome === "unauthorized") return <ResultPanel message={t.securityLookup.unauthorized} />;
  if (result.outcome === "not_found") return <ResultPanel message={t.securityLookup.notFound} />;
  if (result.outcome === "error") return <ResultPanel message={t.securityLookup.error} />;
  const { data } = result;
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-5 text-sm">
        <p>
          {data.owner} — {data.purpose} — <Badge variant="neutral">{data.status}</Badge>
        </p>
        <p className="text-muted-foreground">{data.allowedScopes.join(", ")}</p>
        <p className="text-muted-foreground">{data.allowedEnvironments.join(", ")}</p>
      </CardContent>
    </Card>
  );
}

async function CheckConsentResult({
  subjectRef,
  purpose,
  t,
}: {
  readonly subjectRef: string;
  readonly purpose: string;
  readonly t: Dictionary;
}) {
  const result = await checkConsent(subjectRef, purpose);
  if (result.outcome === "unauthorized") return <ResultPanel message={t.securityLookup.unauthorized} />;
  if (result.outcome === "error") return <ResultPanel message={t.securityLookup.error} />;
  const { data } = result;
  return (
    <Card>
      <CardContent className="pt-5">
        <Badge variant={data.granted ? "success" : "destructive"}>
          {data.granted ? t.securityIdentityPage.consentGranted : t.securityIdentityPage.consentNotGranted}
        </Badge>
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
