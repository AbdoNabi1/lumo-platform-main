import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, DatabaseIcon, LockIcon } from "lucide-react";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { FinancePeriodPicker } from "@/components/finance/finance-period-picker";
import {
  fetchBalanceSheet,
  fetchIncomeStatement,
  fetchTrialBalance,
  type BalanceSheetDto,
  type IncomeStatementDto,
  type TrialBalanceDto,
} from "@/lib/api/finance";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const DEFAULT_CURRENCY = "USD";

interface FinancePageProps {
  readonly searchParams: Promise<{
    readonly startDate?: string;
    readonly endDate?: string;
    readonly currency?: string;
  }>;
}

/** The first day of the current month through today, in UTC, as `YYYY-MM-DD`. */
function defaultPeriod(): { readonly startDate: string; readonly endDate: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const toIso = (date: Date) => date.toISOString().slice(0, 10);
  return { startDate: toIso(start), endDate: toIso(now) };
}

/**
 * `/finance` (T3.2) — trial balance, income statement, and balance sheet
 * (`apps/admin/src/http/admin-routes.ts`'s `/finance/*` block) for a period + currency held in the
 * URL. Same streaming shell as Orders/Content: the chrome renders immediately, the three
 * statements resolve inside their own `<Suspense>` boundary so the period picker is never blocked
 * on the three GETs.
 */
export default async function FinancePage({ searchParams }: FinancePageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const params = await searchParams;
  const defaults = defaultPeriod();
  const startDate = params.startDate ?? defaults.startDate;
  const endDate = params.endDate ?? defaults.endDate;
  const currency = (params.currency ?? DEFAULT_CURRENCY).toUpperCase();

  return (
    <AppShell t={t} locale={locale} activeNavId="finance" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{t.financePage.title}</h1>
            <p className="text-md text-muted-foreground mt-1">{t.financePage.subtitle}</p>
          </div>
          <Link
            href="/finance/read-models"
            className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
          >
            <DatabaseIcon aria-hidden="true" className="size-4" />
            {t.financePage.readModelsLink}
          </Link>
        </header>

        <FinancePeriodPicker
          t={t}
          defaultStartDate={startDate}
          defaultEndDate={endDate}
          defaultCurrency={currency}
        />

        <Suspense
          key={`${startDate}:${endDate}:${currency}`}
          fallback={<StatementsSkeleton />}
        >
          <FinanceStatements
            startDate={startDate}
            endDate={endDate}
            currency={currency}
            t={t}
            locale={locale}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function FinanceStatements({
  startDate,
  endDate,
  currency,
  t,
  locale,
}: {
  readonly startDate: string;
  readonly endDate: string;
  readonly currency: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const [trialBalance, incomeStatement, balanceSheet] = await Promise.all([
    fetchTrialBalance(startDate, endDate, currency),
    fetchIncomeStatement(startDate, endDate, currency),
    fetchBalanceSheet(startDate, endDate, currency),
  ]);

  return (
    <Tabs defaultValue="trial-balance">
      <TabsList>
        <TabsTrigger value="trial-balance">{t.financePage.tabs.trialBalance}</TabsTrigger>
        <TabsTrigger value="income-statement">{t.financePage.tabs.incomeStatement}</TabsTrigger>
        <TabsTrigger value="balance-sheet">{t.financePage.tabs.balanceSheet}</TabsTrigger>
      </TabsList>

      <TabsContent value="trial-balance">
        <TrialBalancePanel result={trialBalance} t={t} locale={locale} currency={currency} />
      </TabsContent>
      <TabsContent value="income-statement">
        <IncomeStatementPanel result={incomeStatement} t={t} locale={locale} />
      </TabsContent>
      <TabsContent value="balance-sheet">
        <BalanceSheetPanel result={balanceSheet} t={t} locale={locale} />
      </TabsContent>
    </Tabs>
  );
}

function TrialBalancePanel({
  result,
  t,
  locale,
  currency,
}: {
  readonly result:
    | { readonly outcome: "ok"; readonly data: TrialBalanceDto }
    | { readonly outcome: "unauthorized" }
    | { readonly outcome: "error"; readonly message: string };
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly currency: string;
}) {
  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.financePage.trialBalance.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.financePage.trialBalance.error}
      />
    );
  }
  if (result.data.rows.length === 0) {
    return (
      <StatePanel
        icon={<DatabaseIcon aria-hidden="true" className="size-5" />}
        message={t.financePage.trialBalance.empty}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <Table aria-label={t.financePage.tabs.trialBalance}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.financePage.trialBalance.columns.account}</TableHead>
              <TableHead className="text-end">{t.financePage.trialBalance.columns.debit}</TableHead>
              <TableHead className="text-end">{t.financePage.trialBalance.columns.credit}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.rows.map((row) => (
              <TableRow key={row.accountRef}>
                <TableCell className="font-medium">{row.accountRef}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatCurrency(locale, row.debitMinor, currency)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatCurrency(locale, row.creditMinor, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function IncomeStatementPanel({
  result,
  t,
  locale,
}: {
  readonly result:
    | { readonly outcome: "ok"; readonly data: IncomeStatementDto }
    | { readonly outcome: "unauthorized" }
    | { readonly outcome: "error"; readonly message: string };
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.financePage.incomeStatement.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.financePage.incomeStatement.error}
      />
    );
  }

  const rows: readonly [string, { readonly amountMinor: number; readonly currency: string }][] = [
    [t.financePage.incomeStatement.revenue, result.data.revenue],
    [t.financePage.incomeStatement.cogs, result.data.cogs],
    [t.financePage.incomeStatement.expenses, result.data.expenses],
    [t.financePage.incomeStatement.netIncome, result.data.netIncome],
  ];

  return <AmountTable rows={rows} t={t} locale={locale} ariaLabel={t.financePage.tabs.incomeStatement} />;
}

function BalanceSheetPanel({
  result,
  t,
  locale,
}: {
  readonly result:
    | { readonly outcome: "ok"; readonly data: BalanceSheetDto }
    | { readonly outcome: "unauthorized" }
    | { readonly outcome: "error"; readonly message: string };
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  if (result.outcome === "unauthorized") {
    return (
      <StatePanel
        icon={<LockIcon aria-hidden="true" className="size-5" />}
        message={t.financePage.balanceSheet.unauthorized}
      />
    );
  }
  if (result.outcome === "error") {
    return (
      <StatePanel
        icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
        message={t.financePage.balanceSheet.error}
      />
    );
  }

  const rows: readonly [string, { readonly amountMinor: number; readonly currency: string }][] = [
    [t.financePage.balanceSheet.assets, result.data.assets],
    [t.financePage.balanceSheet.liabilities, result.data.liabilities],
    [t.financePage.balanceSheet.equity, result.data.equity],
  ];

  return <AmountTable rows={rows} t={t} locale={locale} ariaLabel={t.financePage.tabs.balanceSheet} />;
}

function AmountTable({
  rows,
  locale,
  ariaLabel,
}: {
  readonly rows: readonly [string, { readonly amountMinor: number; readonly currency: string }][];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly ariaLabel: string;
}) {
  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <Table aria-label={ariaLabel}>
          <TableBody>
            {rows.map(([label, money]) => (
              <TableRow key={label}>
                <TableCell className="font-medium">{label}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatCurrency(locale, money.amountMinor, money.currency)}
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

function StatementsSkeleton() {
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
