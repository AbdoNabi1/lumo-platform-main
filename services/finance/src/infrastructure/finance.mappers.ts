import { createHash } from "node:crypto";
import { Money, UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { Account } from "../domain/account";
import { Budget } from "../domain/budget";
import { CogsSnapshot } from "../domain/cogs-snapshot";
import { CostCenter } from "../domain/cost-center";
import { ExchangeRate } from "../domain/exchange-rate";
import { Expense } from "../domain/expense";
import { ExpenseCategory } from "../domain/expense-category";
import { FinancialSnapshot } from "../domain/financial-snapshot";
import { FiscalPeriod } from "../domain/fiscal-period";
import { Journal } from "../domain/journal";
import { TaxProfile } from "../domain/tax-profile";
import { AccountType, type AccountTypeValue } from "../domain/value-objects/account-type";
import { Balance } from "../domain/value-objects/balance";
import { CostComponent, type CostComponentType } from "../domain/value-objects/cost-component";
import { JournalLine } from "../domain/value-objects/journal-line";
import {
  LedgerDirection,
  type LedgerDirectionValue,
} from "../domain/value-objects/ledger-direction";
import { LedgerEntry } from "../domain/value-objects/ledger-entry";
import { TaxRate } from "../domain/value-objects/tax-rate";

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(`Corrupt finance row: invalid ${what} (${result.error.message})`);
  }
  return result.value;
}

/** RFC-4122-shaped (version 5, variant 10) UUID deterministically derived from `input`. */
function deterministicUuid(input: string): string {
  const hex = createHash("sha1").update(input).digest("hex").slice(0, 32);
  const timeLow = hex.slice(0, 8);
  const timeMid = hex.slice(8, 12);
  const timeHiAndVersion = `5${hex.slice(13, 16)}`;
  const variantNibble = ((parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const clockSeq = `${variantNibble}${hex.slice(17, 20)}`;
  const node = hex.slice(20, 32);
  return `${timeLow}-${timeMid}-${timeHiAndVersion}-${clockSeq}-${node}`;
}

// -- Journal / LedgerEntry --------------------------------------------------------------------

export interface JournalRow {
  readonly id: string;
  readonly sourceRef: string;
  readonly currency: string;
  readonly reversalOfJournalId: string | null;
  readonly postedAt: Date | null;
}
export interface LedgerEntryRow {
  readonly id: string;
  readonly journalId: string;
  readonly sourceRef: string;
  readonly accountRef: string;
  readonly direction: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly memo: string | null;
  readonly postedAt: Date;
}

/** `Journal`/`LedgerEntry` mapping — the append-only ledger. ShippingRateCard fragments: none. */
export class FinanceMapper {
  static journalToDomain(row: JournalRow, lines: readonly LedgerEntryRow[]): Journal {
    return Journal.reconstitute(
      UniqueEntityId.from(row.id),
      row.sourceRef,
      row.currency,
      lines.map((line) =>
        JournalLine.create(
          line.accountRef,
          LedgerDirection.from(line.direction as LedgerDirectionValue),
          must(Money.create(line.amountMinor, line.currency), "ledger entry amount"),
          line.memo ?? undefined,
        ),
      ),
      row.reversalOfJournalId === null ? null : UniqueEntityId.from(row.reversalOfJournalId),
      row.postedAt,
      0,
    );
  }

  static journalToRow(journal: Journal, tenantId: string) {
    return {
      id: journal.id.toString(),
      tenantId,
      sourceRef: journal.sourceRef,
      currency: journal.currency,
      reversalOfJournalId: journal.reversalOfJournalId?.toString() ?? null,
      postedAt: journal.postedAt,
    };
  }

  static ledgerEntryRows(journal: Journal, tenantId: string) {
    if (!journal.isPosted) return [];
    return journal.toLedgerEntries().map((entry) => ({
      // Phase A.25 (Task 9): `ledger_entries.id` is `@db.Uuid` — this used to be the composite
      // string `journalId:accountRef:direction` directly, which Postgres/Prisma rejects as an
      // invalid UUID (caught by the first real-Postgres integration test this repository ever
      // had). Hashed into a deterministic UUID so the idempotency property the composite key was
      // for — replaying the same journal produces the same ledger-entry ids, so `skipDuplicates`
      // still dedupes correctly — is preserved.
      id: deterministicUuid(
        `${journal.id.toString()}:${entry.accountRef}:${entry.direction.value}`,
      ),
      tenantId,
      journalId: journal.id.toString(),
      sourceRef: entry.sourceRef,
      accountRef: entry.accountRef,
      direction: entry.direction.value,
      amountMinor: entry.amount.amountMinor,
      currency: entry.amount.currency,
      memo: entry.memo ?? null,
      postedAt: entry.postedAt,
    }));
  }

  static ledgerEntryToDomain(row: LedgerEntryRow): LedgerEntry {
    return LedgerEntry.create({
      journalId: UniqueEntityId.from(row.journalId),
      sourceRef: row.sourceRef,
      accountRef: row.accountRef,
      direction: LedgerDirection.from(row.direction as LedgerDirectionValue),
      amount: must(Money.create(row.amountMinor, row.currency), "ledger entry amount"),
      memo: row.memo ?? undefined,
      postedAt: row.postedAt,
    });
  }

  // -- Account ------------------------------------------------------------------------------

  static accountToDomain(row: {
    id: string;
    code: string;
    name: string;
    type: string;
    active: boolean;
    version: number;
  }): Account {
    return Account.reconstitute(
      UniqueEntityId.from(row.id),
      row.code,
      row.name,
      AccountType.from(row.type as AccountTypeValue),
      row.active,
      row.version,
    );
  }

  static accountToRow(account: Account, tenantId: string) {
    return {
      id: account.id.toString(),
      tenantId,
      code: account.code,
      name: account.name,
      type: account.type.value,
      active: account.active,
    };
  }

  // -- CostCenter ------------------------------------------------------------------------------

  static costCenterToDomain(row: {
    id: string;
    code: string;
    name: string;
    active: boolean;
    version: number;
  }): CostCenter {
    return CostCenter.reconstitute(
      UniqueEntityId.from(row.id),
      row.code,
      row.name,
      row.active,
      row.version,
    );
  }

  static costCenterToRow(costCenter: CostCenter, tenantId: string) {
    return {
      id: costCenter.id.toString(),
      tenantId,
      code: costCenter.code,
      name: costCenter.name,
      active: costCenter.active,
    };
  }

  // -- ExpenseCategory ---------------------------------------------------------------------------

  static expenseCategoryToDomain(row: {
    id: string;
    name: string;
    costCenterRef: string | null;
    version: number;
  }): ExpenseCategory {
    return ExpenseCategory.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      row.costCenterRef,
      row.version,
    );
  }

  static expenseCategoryToRow(category: ExpenseCategory, tenantId: string) {
    return {
      id: category.id.toString(),
      tenantId,
      name: category.name,
      costCenterRef: category.costCenterRef,
    };
  }

  // -- Expense --------------------------------------------------------------------------------

  static expenseToDomain(row: {
    id: string;
    costCenterRef: string;
    categoryRef: string;
    amountMinor: number;
    currency: string;
    description: string;
    incurredAt: Date;
  }): Expense {
    return Expense.reconstitute(
      UniqueEntityId.from(row.id),
      row.costCenterRef,
      row.categoryRef,
      must(Money.create(row.amountMinor, row.currency), "expense amount"),
      row.description,
      row.incurredAt,
      0,
    );
  }

  static expenseToRow(expense: Expense, tenantId: string) {
    return {
      id: expense.id.toString(),
      tenantId,
      costCenterRef: expense.costCenterRef,
      categoryRef: expense.categoryRef,
      amountMinor: expense.amount.amountMinor,
      currency: expense.amount.currency,
      description: expense.description,
      incurredAt: expense.incurredAt,
    };
  }

  // -- Budget ---------------------------------------------------------------------------------

  static budgetToDomain(row: {
    id: string;
    costCenterRef: string;
    period: string;
    amountMinor: number;
    currency: string;
    revisions: number;
    version: number;
  }): Budget {
    return Budget.reconstitute(
      UniqueEntityId.from(row.id),
      row.costCenterRef,
      row.period,
      must(Money.create(row.amountMinor, row.currency), "budget amount"),
      row.revisions,
      row.version,
    );
  }

  static budgetToRow(budget: Budget, tenantId: string) {
    return {
      id: budget.id.toString(),
      tenantId,
      costCenterRef: budget.costCenterRef,
      period: budget.period,
      amountMinor: budget.amount.amountMinor,
      currency: budget.amount.currency,
      revisions: budget.revisions,
    };
  }

  // -- ExchangeRate -----------------------------------------------------------------------------

  static exchangeRateToDomain(row: {
    id: string;
    baseCurrency: string;
    quoteCurrency: string;
    // WP-11 (F-07): `rate` is `Decimal` in the schema now (was `Float`) — Prisma returns a
    // `Prisma.Decimal` instance for it at runtime, not a plain `number`. `unknown` (rather than
    // a convenience-lie `number`) forces the explicit `Number(...)` conversion below.
    rate: unknown;
    effectiveAt: Date;
  }): ExchangeRate {
    return ExchangeRate.reconstitute(
      UniqueEntityId.from(row.id),
      row.baseCurrency,
      row.quoteCurrency,
      // `Number(x)` on a `Prisma.Decimal` calls its `valueOf()`/`toString()` (decimal.js), the
      // exact decimal string — a correct, one-time conversion. `ExchangeRate` is immutable (its
      // own doc comment: "never updated"), so no repeated-arithmetic drift risk exists here.
      Number(row.rate),
      row.effectiveAt,
      0,
    );
  }

  static exchangeRateToRow(rate: ExchangeRate, tenantId: string) {
    return {
      id: rate.id.toString(),
      tenantId,
      baseCurrency: rate.baseCurrency,
      quoteCurrency: rate.quoteCurrency,
      rate: rate.rate,
      effectiveAt: rate.effectiveAt,
    };
  }

  // -- FiscalPeriod -----------------------------------------------------------------------------

  static fiscalPeriodToDomain(row: {
    id: string;
    startDate: Date;
    endDate: Date;
    closed: boolean;
    version: number;
  }): FiscalPeriod {
    return FiscalPeriod.reconstitute(
      UniqueEntityId.from(row.id),
      row.startDate,
      row.endDate,
      row.closed,
      row.version,
    );
  }

  static fiscalPeriodToRow(period: FiscalPeriod, tenantId: string) {
    return {
      id: period.id.toString(),
      tenantId,
      startDate: period.startDate,
      endDate: period.endDate,
      closed: period.closed,
    };
  }

  // -- TaxProfile -------------------------------------------------------------------------------

  static taxProfileToDomain(row: {
    id: string;
    jurisdiction: string;
    rates: unknown;
    version: number;
  }): TaxProfile {
    const rates = (row.rates as readonly { basisPoints: number }[]).map((r) =>
      must(TaxRate.create(r.basisPoints), "tax rate"),
    );
    return TaxProfile.reconstitute(
      UniqueEntityId.from(row.id),
      row.jurisdiction,
      rates,
      row.version,
    );
  }

  static taxProfileToRow(profile: TaxProfile, tenantId: string) {
    return {
      id: profile.id.toString(),
      tenantId,
      jurisdiction: profile.jurisdiction,
      rates: profile.rates.map((rate) => ({ basisPoints: rate.basisPoints })),
    };
  }

  // -- CogsSnapshot -----------------------------------------------------------------------------

  static cogsSnapshotToDomain(row: {
    id: string;
    productRef: string;
    components: unknown;
    currency: string;
    effectiveAt: Date;
  }): CogsSnapshot {
    const components = (
      row.components as readonly { type: CostComponentType; amountMinor: number }[]
    ).map((c) =>
      CostComponent.create(
        c.type,
        must(Money.create(c.amountMinor, row.currency), "cost component"),
      ),
    );
    return CogsSnapshot.reconstitute(
      UniqueEntityId.from(row.id),
      row.productRef,
      components,
      row.effectiveAt,
      0,
    );
  }

  static cogsSnapshotToRow(snapshot: CogsSnapshot, tenantId: string, currency: string) {
    return {
      id: snapshot.id.toString(),
      tenantId,
      productRef: snapshot.productRef,
      components: snapshot.components.map((c) => ({
        type: c.type,
        amountMinor: c.amount.amountMinor,
      })),
      currency,
      effectiveAt: snapshot.effectiveAt,
    };
  }

  // -- FinancialSnapshot ------------------------------------------------------------------------

  static financialSnapshotToDomain(row: {
    id: string;
    period: string;
    currency: string;
    figures: unknown;
  }): FinancialSnapshot {
    const raw = row.figures as Readonly<Record<string, number>>;
    const figures = new Map<string, Balance>(
      Object.entries(raw).map(([name, amountMinor]) => [
        name,
        Balance.of(amountMinor, row.currency),
      ]),
    );
    return FinancialSnapshot.reconstitute(
      UniqueEntityId.from(row.id),
      row.period,
      row.currency,
      figures,
      0,
    );
  }

  static financialSnapshotToRow(snapshot: FinancialSnapshot, tenantId: string) {
    const figures: Record<string, number> = {};
    for (const [name, balance] of snapshot.figures) {
      figures[name] = balance.amountMinor;
    }
    return {
      id: snapshot.id.toString(),
      tenantId,
      period: snapshot.period,
      currency: snapshot.currency,
      figures,
    };
  }
}
