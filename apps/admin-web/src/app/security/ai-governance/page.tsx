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
  CheckAiActionPanel,
  GovernAiIdentityForm,
  SuspendAiIdentityForm,
} from "@/components/security/ai-governance-actions";
import { fetchAiGovernanceExplorer } from "@/lib/api/security";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * `/security/ai-governance` — governed AI identities: budgets, quotas, and sandbox isolation
 * (T3.1, read-only explorer). T5.12a adds the write controls: govern (create-or-patch), suspend
 * (kill-switch), and the "check AI action" simulation panel.
 */
export default async function SecurityAiGovernancePage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">{t.securityAiGovernancePage.title}</h1>
        <p className="text-md text-muted-foreground mt-1">{t.securityAiGovernancePage.subtitle}</p>
      </header>

      <Suspense fallback={<TableCardSkeleton />}>
        <AiGovernanceSection t={t} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.securityAiGovernancePage.govern.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <GovernAiIdentityForm t={t} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.securityAiGovernancePage.suspend.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <SuspendAiIdentityForm t={t} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.securityAiGovernancePage.check.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <CheckAiActionPanel t={t} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function AiGovernanceSection({ t }: { readonly t: Dictionary }) {
  const result = await fetchAiGovernanceExplorer();
  if (result.outcome === "unauthorized") {
    return <StatePanel icon={<LockIcon aria-hidden="true" className="size-5" />} message={t.securityAiGovernancePage.unauthorized} />;
  }
  if (result.outcome === "error") {
    return <StatePanel icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />} message={t.securityAiGovernancePage.error} />;
  }
  const { data } = result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.securityAiGovernancePage.explorerTitle}</CardTitle>
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">
            {t.securityAiGovernancePage.total}: <span className="text-foreground font-medium">{data.total}</span>
          </span>
          <span className="text-muted-foreground">
            {t.securityAiGovernancePage.active}: <span className="text-foreground font-medium">{data.active}</span>
          </span>
          <span className="text-muted-foreground">
            {t.securityAiGovernancePage.suspended}: <span className="text-foreground font-medium">{data.suspended}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {data.identities.length === 0 ? (
          <p className="text-muted-foreground p-5 text-center text-base">{t.securityAiGovernancePage.empty}</p>
        ) : (
          <Table aria-label={t.securityAiGovernancePage.explorerTitle}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.securityAiGovernancePage.columns.principalRef}</TableHead>
                <TableHead>{t.securityAiGovernancePage.columns.status}</TableHead>
                <TableHead>{t.securityAiGovernancePage.columns.tokenBudget}</TableHead>
                <TableHead>{t.securityAiGovernancePage.columns.tokensConsumed}</TableHead>
                <TableHead>{t.securityAiGovernancePage.columns.callQuota}</TableHead>
                <TableHead>{t.securityAiGovernancePage.columns.callsConsumed}</TableHead>
                <TableHead>{t.securityAiGovernancePage.columns.isolationLevel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.identities.map((identity) => (
                <TableRow key={identity.principalRef}>
                  <TableCell className="font-medium">{identity.principalRef}</TableCell>
                  <TableCell>
                    <Badge variant={identity.status === "active" ? "success" : "neutral"}>{identity.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {identity.tokenBudget ?? t.securityAiGovernancePage.unlimited}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{identity.tokensConsumed}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {identity.callQuota ?? t.securityAiGovernancePage.unlimited}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{identity.callsConsumed}</TableCell>
                  <TableCell className="text-muted-foreground">{identity.isolationLevel}</TableCell>
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
