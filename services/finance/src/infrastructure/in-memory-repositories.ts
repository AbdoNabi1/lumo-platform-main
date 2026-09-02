import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Account } from "../domain/account";
import type { Budget } from "../domain/budget";
import type { CogsSnapshot } from "../domain/cogs-snapshot";
import type { CostCenter } from "../domain/cost-center";
import type { ExchangeRate } from "../domain/exchange-rate";
import type { Expense } from "../domain/expense";
import type { ExpenseCategory } from "../domain/expense-category";
import type { FinancialSnapshot } from "../domain/financial-snapshot";
import type { FiscalPeriod } from "../domain/fiscal-period";
import type { Journal } from "../domain/journal";
import type { TaxProfile } from "../domain/tax-profile";
import type { LedgerEntry } from "../domain/value-objects/ledger-entry";
import type {
  AccountRepository,
  BudgetRepository,
  CogsSnapshotRepository,
  CostCenterRepository,
  ExchangeRateRepository,
  ExpenseCategoryRepository,
  ExpenseRepository,
  FinancialSnapshotRepository,
  FiscalPeriodRepository,
  JournalRepository,
  LedgerEntryRepository,
  TaxProfileRepository,
} from "../domain/repositories";

export interface OutboxBackedDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * `ShippingRateCard`/`ShippingRate`/`QuoteShippingRates`-specific persistence is **not**
 * implemented anywhere in this file (T1-Core scope freeze, `FINAL_EXECUTION_PLAN_V5.md` row 9 /
 * `T1_PRE_FLIGHT_REPORT.md` §9) — every repository below persists only the T1-Core aggregates.
 */

/** Append-only ledger. Persists journals, derives {@link LedgerEntry} facts, writes to the outbox. */
export class InMemoryJournalRepository implements JournalRepository, LedgerEntryRepository {
  private readonly journals = new Map<string, Journal>();
  private readonly entries: LedgerEntry[] = [];
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async append(journal: Journal, tx?: unknown): Promise<void> {
    this.journals.set(journal.id.toString(), journal);
    if (journal.isPosted) {
      this.entries.push(...journal.toLedgerEntries());
    }
    await this.deps.outbox.write(journal.pullDomainEvents(), this.deps.context, tx);
  }

  async findById(id: string): Promise<Journal | null> {
    return this.journals.get(id) ?? null;
  }

  async findBySourceRef(sourceRef: string): Promise<readonly Journal[]> {
    return [...this.journals.values()].filter((journal) => journal.sourceRef === sourceRef);
  }

  async findByAccount(accountRef: string): Promise<readonly LedgerEntry[]> {
    return this.entries.filter((entry) => entry.accountRef === accountRef);
  }

  async findByPeriod(startDate: Date, endDate: Date): Promise<readonly LedgerEntry[]> {
    return this.entries.filter((entry) => entry.postedAt >= startDate && entry.postedAt <= endDate);
  }

  async list(): Promise<readonly LedgerEntry[]> {
    return this.entries;
  }
}

export class InMemoryAccountRepository implements AccountRepository {
  private readonly store = new Map<string, Account>();

  async save(account: Account): Promise<void> {
    this.store.set(account.id.toString(), account);
  }

  async findById(id: string): Promise<Account | null> {
    return this.store.get(id) ?? null;
  }

  async findByCode(code: string): Promise<Account | null> {
    return [...this.store.values()].find((account) => account.code === code) ?? null;
  }

  async list(): Promise<readonly Account[]> {
    return [...this.store.values()];
  }
}

export class InMemoryCostCenterRepository implements CostCenterRepository {
  private readonly store = new Map<string, CostCenter>();

  async save(costCenter: CostCenter): Promise<void> {
    this.store.set(costCenter.id.toString(), costCenter);
  }

  async findById(id: string): Promise<CostCenter | null> {
    return this.store.get(id) ?? null;
  }

  async list(): Promise<readonly CostCenter[]> {
    return [...this.store.values()];
  }
}

export class InMemoryExpenseCategoryRepository implements ExpenseCategoryRepository {
  private readonly store = new Map<string, ExpenseCategory>();

  async save(category: ExpenseCategory): Promise<void> {
    this.store.set(category.id.toString(), category);
  }

  async findById(id: string): Promise<ExpenseCategory | null> {
    return this.store.get(id) ?? null;
  }

  async list(): Promise<readonly ExpenseCategory[]> {
    return [...this.store.values()];
  }
}

export class InMemoryExpenseRepository implements ExpenseRepository {
  private readonly store = new Map<string, Expense>();
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async save(expense: Expense, tx?: unknown): Promise<void> {
    this.store.set(expense.id.toString(), expense);
    await this.deps.outbox.write(expense.pullDomainEvents(), this.deps.context, tx);
  }

  async findById(id: string): Promise<Expense | null> {
    return this.store.get(id) ?? null;
  }

  async findByPeriod(startDate: Date, endDate: Date): Promise<readonly Expense[]> {
    return [...this.store.values()].filter(
      (expense) => expense.incurredAt >= startDate && expense.incurredAt <= endDate,
    );
  }
}

export class InMemoryBudgetRepository implements BudgetRepository {
  private readonly store = new Map<string, Budget>();
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async save(budget: Budget, tx?: unknown): Promise<void> {
    this.store.set(budget.id.toString(), budget);
    await this.deps.outbox.write(budget.pullDomainEvents(), this.deps.context, tx);
  }

  async findById(id: string): Promise<Budget | null> {
    return this.store.get(id) ?? null;
  }

  async findByCostCenterAndPeriod(costCenterRef: string, period: string): Promise<Budget | null> {
    return (
      [...this.store.values()].find(
        (budget) => budget.costCenterRef === costCenterRef && budget.period === period,
      ) ?? null
    );
  }
}

export class InMemoryExchangeRateRepository implements ExchangeRateRepository {
  private readonly rates: ExchangeRate[] = [];

  async add(rate: ExchangeRate): Promise<void> {
    this.rates.push(rate);
  }

  async findEffective(
    baseCurrency: string,
    quoteCurrency: string,
    at: Date,
  ): Promise<ExchangeRate | null> {
    const candidates = this.rates
      .filter(
        (rate) =>
          rate.baseCurrency === baseCurrency &&
          rate.quoteCurrency === quoteCurrency &&
          rate.effectiveAt.getTime() <= at.getTime(),
      )
      .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime());
    return candidates[0] ?? null;
  }

  async list(baseCurrency: string, quoteCurrency: string): Promise<readonly ExchangeRate[]> {
    return this.rates.filter(
      (rate) => rate.baseCurrency === baseCurrency && rate.quoteCurrency === quoteCurrency,
    );
  }
}

export class InMemoryFiscalPeriodRepository implements FiscalPeriodRepository {
  private readonly store = new Map<string, FiscalPeriod>();
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async save(period: FiscalPeriod, tx?: unknown): Promise<void> {
    this.store.set(period.id.toString(), period);
    await this.deps.outbox.write(period.pullDomainEvents(), this.deps.context, tx);
  }

  async findById(id: string): Promise<FiscalPeriod | null> {
    return this.store.get(id) ?? null;
  }

  async findCurrent(at: Date): Promise<FiscalPeriod | null> {
    return (
      [...this.store.values()].find((period) => period.startDate <= at && period.endDate >= at) ??
      null
    );
  }
}

export class InMemoryTaxProfileRepository implements TaxProfileRepository {
  private readonly store = new Map<string, TaxProfile>();

  async save(profile: TaxProfile): Promise<void> {
    this.store.set(profile.id.toString(), profile);
  }

  async findById(id: string): Promise<TaxProfile | null> {
    return this.store.get(id) ?? null;
  }

  async findByJurisdiction(jurisdiction: string): Promise<TaxProfile | null> {
    return (
      [...this.store.values()].find((profile) => profile.jurisdiction === jurisdiction) ?? null
    );
  }
}

export class InMemoryCogsSnapshotRepository implements CogsSnapshotRepository {
  private readonly snapshots: CogsSnapshot[] = [];

  async add(snapshot: CogsSnapshot): Promise<void> {
    this.snapshots.push(snapshot);
  }

  async findEffective(productRef: string, at: Date): Promise<CogsSnapshot | null> {
    const candidates = this.snapshots
      .filter(
        (snapshot) =>
          snapshot.productRef === productRef && snapshot.effectiveAt.getTime() <= at.getTime(),
      )
      .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime());
    return candidates[0] ?? null;
  }

  async list(productRef: string): Promise<readonly CogsSnapshot[]> {
    return this.snapshots.filter((snapshot) => snapshot.productRef === productRef);
  }
}

export class InMemoryFinancialSnapshotRepository implements FinancialSnapshotRepository {
  private readonly store = new Map<string, FinancialSnapshot>();
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async save(snapshot: FinancialSnapshot, tx?: unknown): Promise<void> {
    this.store.set(snapshot.id.toString(), snapshot);
    await this.deps.outbox.write(snapshot.pullDomainEvents(), this.deps.context, tx);
  }

  async findById(id: string): Promise<FinancialSnapshot | null> {
    return this.store.get(id) ?? null;
  }

  async findByPeriod(period: string): Promise<FinancialSnapshot | null> {
    return [...this.store.values()].find((snapshot) => snapshot.period === period) ?? null;
  }
}
