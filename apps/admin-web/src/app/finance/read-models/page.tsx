import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon, DatabaseIcon, LockIcon, SearchXIcon } from "lucide-react";
import {
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
import { FinanceModelPicker } from "@/components/finance/finance-model-picker";
import {
  fetchFinanceReadModelPage,
  fetchFinanceReadModelRow,
  FINANCE_READ_MODELS,
  isFinanceReadModelName,
} from "@/lib/api/finance";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatCurrency, formatNumber } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

interface ReadModelsPageProps {
  readonly searchParams: Promise<{ readonly model?: string; readonly key?: string }>;
}

/**
 * `/finance/read-models` (T3.2) — the Finance read-model explorer: pick one of the three models
 * `FinanceProjectionService` actually populates (`services/finance/src/application/
 * finance-projection.service.ts`), list its projected rows, drill into one by key. Both `model`
 * and `key` live in the URL, same streaming-shell pattern as `/finance` and Orders.
 */
export default async function FinanceReadModelsPage({ searchParams }: ReadModelsPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;
  const model = params.model ?? FINANCE_READ_MODELS[0];
  const key = params.key;

  return (
    <AppShell t={t} locale={locale} activeNavId="finance" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header>
          <Link
            href="/finance"
            className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1.5 text-sm font-medium"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            {t.financeReadModelsPage.backToFinance}
          </Link>
          <h1 className="text-4xl font-semibold tracking-tight">{t.financeReadModelsPage.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.financeReadModelsPage.subtitle}</p>
        </header>

        <FinanceModelPicker t={t} selected={model} />

        {!isFinanceReadModelName(model) ? (
          <StatePanel
            icon={<SearchXIcon aria-hidden="true" className="size-5" />}
            message={t.financeReadModelsPage.unsupportedModel.replace("{model}", model)}
          />
        ) : key !== undefined && key.length > 0 ? (
          <Suspense key={`${model}:${key}:detail`} fallback={<ExplorerSkeleton />}>
            <ReadModelDetail model={model} rowKey={key} t={t} locale={locale} />
          </Suspense>
        ) : (
          <Suspense key={`${model}:list`} fallback={<ExplorerSkeleton />}>
            <ReadModelList model={model} t={t} locale={locale} />
          </Suspense>
        )}
      </div>
    </AppShell>
  );
}

async function ReadModelList({
  model,
  t,
  locale,
}: {
  readonly model: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const result = await fetchFinanceReadModelPage(model);

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.financeReadModelsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.financeReadModelsPage.error}
      />
    );
  }
  if (result.data.items.length === 0) {
    return (
      <StatePanel
        icon={<DatabaseIcon aria-hidden="true" className="size-5" />}
        message={t.financeReadModelsPage.empty}
      />
    );
  }

  const rows = result.data.items;
  const columns = columnsOf(rows);

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <Table aria-label={t.financeReadModelsPage.title}>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} className="font-mono text-xs">
                  {column}
                </TableHead>
              ))}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => {
              const rowKey = drillInKeyOf(row);
              return (
                <TableRow key={rowKey ?? index}>
                  {columns.map((column) => (
                    <TableCell key={column} className="tabular-nums">
                      {formatFieldValue(row, column, locale, t)}
                    </TableCell>
                  ))}
                  <TableCell className="text-end">
                    {rowKey !== undefined ? (
                      <Link
                        href={`/finance/read-models?model=${encodeURIComponent(model)}&key=${encodeURIComponent(rowKey)}`}
                        className="text-primary text-sm font-medium hover:underline"
                      >
                        {t.financeReadModelsPage.view}
                      </Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function ReadModelDetail({
  model,
  rowKey,
  t,
  locale,
}: {
  readonly model: string;
  readonly rowKey: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const result = await fetchFinanceReadModelRow(model, rowKey);

  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.financeReadModelsPage.unauthorized}
      />
    );
  }
  if (result.outcome === "not_found") {
    return (
      <StatePanel
        icon={<SearchXIcon aria-hidden="true" className="size-5" />}
        message={t.financeReadModelsPage.notFound}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.financeReadModelsPage.error}
      />
    );
  }

  const entries: readonly (readonly [string, unknown])[] = isPlainObject(result.value)
    ? Object.entries(result.value)
    : [["value", result.value]];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t.financeReadModelsPage.detailTitle}</h2>
          <Link
            href={`/finance/read-models?model=${encodeURIComponent(model)}`}
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            {t.financeReadModelsPage.backToList}
          </Link>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {entries.map(([field]) => (
            <div key={field}>
              <dt className="text-muted-foreground font-mono text-xs">{field}</dt>
              <dd className="tabular-nums">
                {formatFieldValue(result.value, field, locale, t)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The union of every row's own keys, in first-seen order — rows for one model are homogeneous
 * in practice, but this stays correct even if a later row carries an extra field. */
function columnsOf(rows: readonly unknown[]): readonly string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen];
}

/** Every real read-model this explorer lists (`profit`/`margin`/`financial_health`) carries the
 * store key back verbatim as its own `period` field (`services/finance/src/read-models/*.ts`) —
 * the paginated list response itself only returns `value`s, never the underlying store key
 * (`InMemoryReadModelStore.query`), so this is the only way to recover a drillable key. */
function drillInKeyOf(row: unknown): string | undefined {
  if (!isPlainObject(row)) return undefined;
  const period = row["period"];
  return typeof period === "string" && period.length > 0 ? period : undefined;
}

/** `*Minor` fields are minor-unit money facts (`revenueMinor`, `netProfitMinor`, …) — formatted as
 * currency using the row's own `currency` field, divided by 100 only here at the formatting
 * boundary, never upstream. Everything else renders as its own primitive. */
function formatFieldValue(
  row: unknown,
  field: string,
  locale: Locale,
  t: Dictionary,
): ReactNode {
  if (!isPlainObject(row)) return String(row);
  const value = row[field];
  if (field.endsWith("Minor") && typeof value === "number") {
    const currency = typeof row["currency"] === "string" ? row["currency"] : "USD";
    return formatCurrency(locale, value, currency);
  }
  if (typeof value === "boolean") {
    return value ? t.financeReadModelsPage.yes : t.financeReadModelsPage.no;
  }
  if (typeof value === "number") {
    return formatNumber(locale, value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "—";
  }
  return JSON.stringify(value);
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

function ExplorerSkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}
