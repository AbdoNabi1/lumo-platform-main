import type { Account } from "./account";
import type { Budget } from "./budget";
import type { CogsSnapshot } from "./cogs-snapshot";
import type { CostCenter } from "./cost-center";
import type { ExchangeRate } from "./exchange-rate";
import type { Expense } from "./expense";
import type { ExpenseCategory } from "./expense-category";
import type { FinancialSnapshot } from "./financial-snapshot";
import type { FiscalPeriod } from "./fiscal-period";
import type { Journal } from "./journal";
import type { TaxProfile } from "./tax-profile";
import type { LedgerEntry } from "./value-objects/ledger-entry";

/**
 * Per-aggregate persistence ports (M5). `tenantId` is an explicit per-call parameter (ADR-0014,
 * WP-10 T10.3) — none of these aggregates carry their own `tenantId`, so every method takes it
 * rather than deriving it, matching `services/identity`'s access-repository shape. The optional
 * `tx` scopes a call to the caller's transaction (ADR-0003). The ledger
 * (`JournalRepository`/`LedgerEntryRepository`) and every historical/effective-dated record
 * (`ExchangeRateRepository`, `CogsSnapshotRepository`) expose **append/add only — no
 * update/delete path**, matching the immutable-ledger invariant.
 */
export interface JournalRepository {
  append(journal: Journal, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Journal | null>;
  findBySourceRef(sourceRef: string, tenantId: string, tx?: unknown): Promise<readonly Journal[]>;
}

/** Read side of the immutable ledger — entries are written only as a side effect of `JournalRepository.append`. */
export interface LedgerEntryRepository {
  findByAccount(
    accountRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly LedgerEntry[]>;
  findByPeriod(
    startDate: Date,
    endDate: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly LedgerEntry[]>;
  list(tenantId: string, tx?: unknown): Promise<readonly LedgerEntry[]>;
}

export interface AccountRepository {
  save(account: Account, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Account | null>;
  findByCode(code: string, tenantId: string, tx?: unknown): Promise<Account | null>;
  list(tenantId: string, tx?: unknown): Promise<readonly Account[]>;
}

export interface CostCenterRepository {
  save(costCenter: CostCenter, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<CostCenter | null>;
  list(tenantId: string, tx?: unknown): Promise<readonly CostCenter[]>;
}

export interface ExpenseCategoryRepository {
  save(category: ExpenseCategory, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<ExpenseCategory | null>;
  list(tenantId: string, tx?: unknown): Promise<readonly ExpenseCategory[]>;
}

export interface ExpenseRepository {
  save(expense: Expense, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Expense | null>;
  findByPeriod(
    startDate: Date,
    endDate: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Expense[]>;
}

export interface BudgetRepository {
  save(budget: Budget, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Budget | null>;
  findByCostCenterAndPeriod(
    costCenterRef: string,
    period: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Budget | null>;
}

export interface ExchangeRateRepository {
  add(rate: ExchangeRate, tenantId: string, tx?: unknown): Promise<void>;
  findEffective(
    baseCurrency: string,
    quoteCurrency: string,
    at: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<ExchangeRate | null>;
  list(
    baseCurrency: string,
    quoteCurrency: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly ExchangeRate[]>;
}

export interface FiscalPeriodRepository {
  save(period: FiscalPeriod, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<FiscalPeriod | null>;
  findCurrent(at: Date, tenantId: string, tx?: unknown): Promise<FiscalPeriod | null>;
}

export interface TaxProfileRepository {
  save(profile: TaxProfile, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<TaxProfile | null>;
  findByJurisdiction(
    jurisdiction: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<TaxProfile | null>;
}

export interface CogsSnapshotRepository {
  add(snapshot: CogsSnapshot, tenantId: string, tx?: unknown): Promise<void>;
  findEffective(
    productRef: string,
    at: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<CogsSnapshot | null>;
  list(productRef: string, tenantId: string, tx?: unknown): Promise<readonly CogsSnapshot[]>;
}

export interface FinancialSnapshotRepository {
  save(snapshot: FinancialSnapshot, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<FinancialSnapshot | null>;
  findByPeriod(period: string, tenantId: string, tx?: unknown): Promise<FinancialSnapshot | null>;
}
