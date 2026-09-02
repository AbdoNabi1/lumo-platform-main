import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  FlaskConicalIcon,
  LockIcon,
  SearchXIcon,
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
import { ExperimentLifecycleActions } from "@/components/experiments/experiment-lifecycle-actions";
import { ExperimentStatusBadge } from "@/components/experiments/experiment-status-badge";
import { fetchExperiment } from "@/lib/api/experimentation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface ExperimentDetailPageProps {
  readonly params: Promise<{ readonly experimentId: string }>;
}

/**
 * The Experiment Detail screen (T5.11b). Resolves the real `GET /experiments/:experimentId`
 * endpoint (`experiments:read`) and renders every `ExperimentDto` field, including the variants/
 * results tables, plus the gated lifecycle controls (`ExperimentLifecycleActions`). Reachable by
 * any authenticated viewer (`middleware.ts` gates only `/experiments/new` to operator+); every
 * write action here is independently permission-gated server-side, same precedent as every prior
 * Phase 5 detail-page write action.
 */
export default async function ExperimentDetailPage({ params }: ExperimentDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { experimentId } = await params;

  const result = await fetchExperiment(experimentId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="experiments" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.experimentDetail.unauthorized}
          backLabel={t.experimentDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="experiments" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.experimentDetail.notFound}
          backLabel={t.experimentDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="experiments" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.experimentDetail.error}
          backLabel={t.experimentDetail.back}
        />
      </AppShell>
    );
  }

  const experiment = result.experiment;
  const variantKeys = experiment.variants.map((variant) => variant.key);

  return (
    <AppShell t={t} locale={locale} activeNavId="experiments" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/experiments">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.experimentDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-4xl font-semibold tracking-tight">
              <FlaskConicalIcon aria-hidden="true" className="size-7" />
              {experiment.name}
            </h1>
            <ExperimentStatusBadge status={experiment.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{experiment.id}</p>
        </div>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t.experimentDetail.hypothesis}
              value={experiment.hypothesis ?? t.experimentDetail.none}
            />
            <Field label={t.experimentDetail.goalMetricRef} value={experiment.goalMetricRef} />
            <Field
              label={t.experimentDetail.audiencePercentage}
              value={`${experiment.audiencePercentage}%`}
            />
            <Field
              label={t.experimentDetail.audienceSegmentRefs}
              value={
                experiment.audienceSegmentRefs !== null &&
                experiment.audienceSegmentRefs.length > 0
                  ? experiment.audienceSegmentRefs.join(", ")
                  : t.experimentDetail.none
              }
            />
            <Field
              label={t.experimentDetail.featureFlagRef}
              value={experiment.featureFlagRef ?? t.experimentDetail.none}
            />
            <Field
              label={t.experimentDetail.winnerVariantKey}
              value={experiment.winnerVariantKey ?? t.experimentDetail.none}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.experimentDetail.variantsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {experiment.variants.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm sm:px-5">
                {t.experimentDetail.noVariants}
              </p>
            ) : (
              <Table aria-label={t.experimentDetail.variantsTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.experimentDetail.variantKey}</TableHead>
                    <TableHead>{t.experimentDetail.variantAllocationPercentage}</TableHead>
                    <TableHead>{t.experimentDetail.variantIsControl}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experiment.variants.map((variant) => (
                    <TableRow key={variant.key}>
                      <TableCell className="font-mono text-sm font-medium whitespace-nowrap">
                        {variant.key}
                        {experiment.winnerVariantKey === variant.key && (
                          <Badge variant="success" className="ms-2">
                            {t.experimentDetail.winnerBadge}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {variant.allocationPercentage}%
                      </TableCell>
                      <TableCell>
                        <Badge variant={variant.isControl ? "info" : "outline"}>
                          {variant.isControl
                            ? t.experimentDetail.yes
                            : t.experimentDetail.no}
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
            <CardTitle>{t.experimentDetail.resultsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {experiment.results.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm sm:px-5">
                {t.experimentDetail.noResults}
              </p>
            ) : (
              <Table aria-label={t.experimentDetail.resultsTitle}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.experimentDetail.resultVariantKey}</TableHead>
                    <TableHead>{t.experimentDetail.resultMetricValue}</TableHead>
                    <TableHead>{t.experimentDetail.resultSampleSize}</TableHead>
                    <TableHead>{t.experimentDetail.resultOccurredAt}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experiment.results.map((entry, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        {entry.variantKey}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{entry.metricValue}</TableCell>
                      <TableCell className="whitespace-nowrap">{entry.sampleSize}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(locale, entry.occurredAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <ExperimentLifecycleActions
          experimentId={experiment.id}
          status={experiment.status}
          variantKeys={variantKeys}
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
            <Link href="/experiments">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
