import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  LockIcon,
  SearchXIcon,
  ToggleLeftIcon,
} from "lucide-react";
import {
  Badge,
  Button,
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
import { FeatureFlagLifecycleActions } from "@/components/feature-flags/feature-flag-lifecycle-actions";
import { FeatureFlagStatusBadge } from "@/components/feature-flags/feature-flag-status-badge";
import { fetchFeatureFlag } from "@/lib/api/feature-flags";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface FeatureFlagDetailPageProps {
  readonly params: Promise<{ readonly flagId: string }>;
}

/**
 * The Feature Flag Detail screen (T5.11b). Resolves the real `GET /feature-flags/:flagId` endpoint
 * (`feature_flags:read`) and renders every `FeatureFlagDto` field, including the environments/
 * rules/changes tables, plus the gated lifecycle controls (`FeatureFlagLifecycleActions`).
 * Reachable by any authenticated viewer (`middleware.ts` gates only `/feature-flags/new` to
 * operator+); every write action here is independently permission-gated server-side, same
 * precedent as every prior Phase 5 detail-page write action.
 */
export default async function FeatureFlagDetailPage({ params }: FeatureFlagDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { flagId } = await params;

  const result = await fetchFeatureFlag(flagId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="feature-flags" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.featureFlagDetail.unauthorized}
          backLabel={t.featureFlagDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="feature-flags" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.featureFlagDetail.notFound}
          backLabel={t.featureFlagDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="feature-flags" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.featureFlagDetail.error}
          backLabel={t.featureFlagDetail.back}
        />
      </AppShell>
    );
  }

  const flag = result.flag;

  return (
    <AppShell t={t} locale={locale} activeNavId="feature-flags" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/feature-flags">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.featureFlagDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-4xl font-semibold tracking-tight">
              <ToggleLeftIcon aria-hidden="true" className="size-7" />
              {flag.name}
            </h1>
            <FeatureFlagStatusBadge status={flag.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{flag.key}</p>
        </div>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t.featureFlagDetail.key} value={flag.key} />
            <Field label={t.featureFlagDetail.name} value={flag.name} />
            <Field
              label={t.featureFlagDetail.description}
              value={flag.description ?? t.featureFlagDetail.none}
            />
            <Field
              label={t.featureFlagDetail.rolloutPercentage}
              value={`${flag.rolloutPercentage}%`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.featureFlagDetail.environmentsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {flag.environments.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm sm:px-5">
                {t.featureFlagDetail.noEnvironments}
              </p>
            ) : (
              <Table aria-label={t.featureFlagDetail.environmentsTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.featureFlagDetail.environmentName}</TableHead>
                    <TableHead>{t.featureFlagDetail.environmentEnabled}</TableHead>
                    <TableHead>{t.featureFlagDetail.environmentRollout}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flag.environments.map((environment, index) => (
                    <TableRow key={index}>
                      <TableCell className="whitespace-nowrap">
                        {environment.environment}
                      </TableCell>
                      <TableCell>
                        <Badge variant={environment.enabled ? "success" : "outline"}>
                          {environment.enabled
                            ? t.featureFlagDetail.yes
                            : t.featureFlagDetail.no}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {environment.rolloutPercentage !== null
                          ? `${environment.rolloutPercentage}%`
                          : t.featureFlagDetail.none}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.featureFlagDetail.rulesTitle}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {flag.rules.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm sm:px-5">
                {t.featureFlagDetail.noRules}
              </p>
            ) : (
              <Table aria-label={t.featureFlagDetail.rulesTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.featureFlagDetail.ruleType}</TableHead>
                    <TableHead>{t.featureFlagDetail.ruleAttribute}</TableHead>
                    <TableHead>{t.featureFlagDetail.ruleValues}</TableHead>
                    <TableHead>{t.featureFlagDetail.ruleEnabled}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flag.rules.map((rule, index) => (
                    <TableRow key={index}>
                      <TableCell className="whitespace-nowrap">
                        {(t.featureFlagRuleType as Record<string, string>)[rule.type] ??
                          rule.type}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {rule.attribute ?? t.featureFlagDetail.none}
                      </TableCell>
                      <TableCell className="text-sm">{rule.values.join(", ")}</TableCell>
                      <TableCell>
                        <Badge variant={rule.enabled ? "success" : "outline"}>
                          {rule.enabled ? t.featureFlagDetail.yes : t.featureFlagDetail.no}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.featureFlagDetail.changesTitle}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {flag.changes.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm sm:px-5">
                {t.featureFlagDetail.noChanges}
              </p>
            ) : (
              <Table aria-label={t.featureFlagDetail.changesTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.featureFlagDetail.changeAction}</TableHead>
                    <TableHead>{t.featureFlagDetail.changeChangedBy}</TableHead>
                    <TableHead>{t.featureFlagDetail.changeDetails}</TableHead>
                    <TableHead>{t.featureFlagDetail.changeOccurredAt}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flag.changes.map((change, index) => (
                    <TableRow key={index}>
                      <TableCell className="whitespace-nowrap">{change.action}</TableCell>
                      <TableCell className="font-mono text-sm">{change.changedBy}</TableCell>
                      <TableCell className="text-sm">
                        {change.details ?? t.featureFlagDetail.none}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(locale, change.occurredAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <FeatureFlagLifecycleActions
          flagId={flag.id}
          status={flag.status}
          rolloutPercentage={flag.rolloutPercentage}
          changedByDefault={user.name}
          t={t}
        />
      </div>
    </AppShell>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

function StatePanel({
  icon,
  message,
  backLabel,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
          {icon}
          <p role="note">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/feature-flags">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
