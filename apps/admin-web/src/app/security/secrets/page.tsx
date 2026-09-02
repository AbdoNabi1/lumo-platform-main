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
  EmergencyRevokeCredentialsForm,
  RotateDueCredentialsButton,
  ScheduleCredentialRotationForm,
} from "@/components/security/secrets-actions";
import { fetchSecretExplorer, getCredentialLineage } from "@/lib/api/security";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

interface SecretsPageProps {
  readonly searchParams: Promise<{ readonly credentialId?: string }>;
}

/** `/security/secrets` — the secret explorer, plus the credential lineage lookup (T3.1). Never exposes secret values. */
export default async function SecuritySecretsPage({ searchParams }: SecretsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t.securitySecretsPage.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.securitySecretsPage.subtitle}</p>
      </header>

      <Suspense fallback={<TableCardSkeleton />}>
        <SecretExplorerSection t={t} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.securitySecretsPage.scheduleRotation.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <ScheduleCredentialRotationForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.securitySecretsPage.rotateDue.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <RotateDueCredentialsButton t={t} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.securitySecretsPage.emergencyRevoke.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <EmergencyRevokeCredentialsForm t={t} />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <SecurityLookupForm
          title={t.securitySecretsPage.lookups.lineage.title}
          submitLabel={t.securityLookup.submit}
          fields={[
            {
              name: "credentialId",
              label: t.securitySecretsPage.lookups.lineage.fieldLabel,
              defaultValue: params.credentialId,
            },
          ]}
        />
        {params.credentialId !== undefined && params.credentialId.length > 0 && (
          <Suspense key={params.credentialId} fallback={<ResultSkeleton />}>
            <CredentialLineageResult credentialId={params.credentialId} t={t} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

async function SecretExplorerSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchSecretExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securitySecretsPage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securitySecretsPage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securitySecretsPage.secretsTitle}</CardTitle>
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">
            {t.securitySecretsPage.total}: <span className="text-foreground font-medium">{data.total}</span>
          </span>
          <span className="text-muted-foreground">
            {t.securitySecretsPage.rotationDue}: <span className="text-foreground font-medium">{data.rotationDue}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {data.credentials.length === 0 ? (
          <p className="text-muted-foreground p-5 text-center text-base">{t.securitySecretsPage.empty}</p>
        ) : (
          <Table aria-label={t.securitySecretsPage.secretsTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securitySecretsPage.secretColumns.principalRef}</TableHead>
                <TableHead>{t.securitySecretsPage.secretColumns.kind}</TableHead>
                <TableHead>{t.securitySecretsPage.secretColumns.status}</TableHead>
                <TableHead>{t.securitySecretsPage.secretColumns.rotationDueAt}</TableHead>
                <TableHead>{t.securitySecretsPage.secretColumns.autoRotate}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.credentials.map((credential, index) => (
                <TableRow key={`${credential.principalRef}-${index}`}>
                  <TableCell className="font-medium">{credential.principalRef}</TableCell>
                  <TableCell className="text-muted-foreground">{credential.kind}</TableCell>
                  <TableCell>
                    <Badge variant="neutral">{credential.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {credential.rotationDueAt ?? t.securitySecretsPage.noRotationScheduled}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {credential.autoRotate ? t.securitySecretsPage.yes : t.securitySecretsPage.no}
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

async function CredentialLineageResult({
  credentialId,
  t,
}: {
  readonly credentialId: string;
  readonly t: Dictionary;
}) {
  const result = await getCredentialLineage(credentialId);
  if (result.outcome === "unauthorized") return <ResultPanel message={t.securityLookup.unauthorized} />;
  if (result.outcome === "not_found") return <ResultPanel message={t.securityLookup.notFound} />;
  if (result.outcome === "error") return <ResultPanel message={t.securityLookup.error} />;
  const { data } = result;
  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <Table aria-label={t.securitySecretsPage.lookups.lineage.title}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.securitySecretsPage.lineageColumns.id}</TableHead>
              <TableHead>{t.securitySecretsPage.lineageColumns.kind}</TableHead>
              <TableHead>{t.securitySecretsPage.lineageColumns.status}</TableHead>
              <TableHead>{t.securitySecretsPage.lineageColumns.supersedes}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.chain.map((credential) => (
              <TableRow key={credential.id}>
                <TableCell className="font-medium">{credential.id}</TableCell>
                <TableCell className="text-muted-foreground">{credential.kind}</TableCell>
                <TableCell>
                  <Badge variant="neutral">{credential.status}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {credential.supersedesRef ?? t.securitySecretsPage.noRotationScheduled}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
