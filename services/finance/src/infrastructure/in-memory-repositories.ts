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
 *
 * ADR-0014 (WP-10 T10.3): every store below is keyed by `(tenantId, id)`, not just `id` — an
 * in-memory repository that ignored `tenantId` would make a two-tenant isolation test pass
 * vacuously (it would never see cross-tenant data because nothing here would ever conflict), so
 * the key composition below is the load-bearing part of this file, not a cosmetic change.
 */
function tenantKey(tenantId: string, id: string): string {
  return `${tenantId}:${id}`;
}

/** Append-only ledger. Persists journals, derives {@link LedgerEntry} facts, writes to the outbox. */
export class InMemoryJournalRepository implements JournalRepository, LedgerEntryRepository {
  private readonly journals = new Map<string, Journal>();
  private readonly entries: { readonly tenantId: string; readonly entry: LedgerEntry }[] = [];
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async append(journal: Journal, tenantId: string, tx?: unknown): Promise<void> {
    this.journals.set(tenantKey(tenantId, journal.id.toString()), journal);
    if (journal.isPosted) {
      for (const entry of journal.toLedgerEntries()) {
        this.entries.push({ tenantId, entry });
      }
    }
    await this.deps.outbox.write(
      journal.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }

  async findById(id: string, tenantId: string): Promise<Journal | null> {
    return this.journals.get(tenantKey(tenantId, id)) ?? null;
  }

  async findBySourceRef(sourceRef: string, tenantId: string): Promise<readonly Journal[]> {
    return [...this.journals.entries()]
      .filter(([key, journal]) => key.startsWith(`${tenantId}:`) && journal.sourceRef === sourceRef)
      .map(([, journal]) => journal);
  }

  async findByAccount(accountRef: string, tenantId: string): Promise<readonly LedgerEntry[]> {
    return this.entries
      .filter((row) => row.tenantId === tenantId && row.entry.accountRef === accountRef)
      .map((row) => row.entry);
  }

  async findByPeriod(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<readonly LedgerEntry[]> {
    return this.entries
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.entry.postedAt >= startDate &&
          row.entry.postedAt <= endDate,
      )
      .map((row) => row.entry);
  }

  async list(tenantId: string): Promise<readonly LedgerEntry[]> {
    return this.entries.filter((row) => row.tenantId === tenantId).map((row) => row.entry);
  }
}

export class InMemoryAccountRepository implements AccountRepository {
  private readonly store = new Map<string, Account>();

  async save(account: Account, tenantId: string): Promise<void> {
    this.store.set(tenantKey(tenantId, account.id.toString()), account);
  }

  async findById(id: string, tenantId: string): Promise<Account | null> {
    return this.store.get(tenantKey(tenantId, id)) ?? null;
  }

  async findByCode(code: string, tenantId: string): Promise<Account | null> {
    return (
      [...this.store.entries()].find(
        ([key, account]) => key.startsWith(`${tenantId}:`) && account.code === code,
      )?.[1] ?? null
    );
  }

  async list(tenantId: string): Promise<readonly Account[]> {
    return [...this.store.entries()]
      .filter(([key]) => key.startsWith(`${tenantId}:`))
      .map(([, account]) => account);
  }
}

export class InMemoryCostCenterRepository implements CostCenterRepository {
  private readonly store = new Map<string, CostCenter>();

  async save(costCenter: CostCenter, tenantId: string): Promise<void> {
    this.store.set(tenantKey(tenantId, costCenter.id.toString()), costCenter);
  }

  async findById(id: string, tenantId: string): Promise<CostCenter | null> {
    return this.store.get(tenantKey(tenantId, id)) ?? null;
  }

  async list(tenantId: string): Promise<readonly CostCenter[]> {
    return [...this.store.entries()]
      .filter(([key]) => key.startsWith(`${tenantId}:`))
      .map(([, costCenter]) => costCenter);
  }
}

export class InMemoryExpenseCategoryRepository implements ExpenseCategoryRepository {
  private readonly store = new Map<string, ExpenseCategory>();

  async save(category: ExpenseCategory, tenantId: string): Promise<void> {
    this.store.set(tenantKey(tenantId, category.id.toString()), category);
  }

  async findById(id: string, tenantId: string): Promise<ExpenseCategory | null> {
    return this.store.get(tenantKey(tenantId, id)) ?? null;
  }

  async list(tenantId: string): Promise<readonly ExpenseCategory[]> {
    return [...this.store.entries()]
      .filter(([key]) => key.startsWith(`${tenantId}:`))
      .map(([, category]) => category);
  }
}

export class InMemoryExpenseRepository implements ExpenseRepository {
  private readonly store = new Map<string, Expense>();
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async save(expense: Expense, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(tenantKey(tenantId, expense.id.toString()), expense);
    await this.deps.outbox.write(
      expense.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }

  async findById(id: string, tenantId: string): Promise<Expense | null> {
    return this.store.get(tenantKey(tenantId, id)) ?? null;
  }

  async findByPeriod(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<readonly Expense[]> {
    return [...this.store.entries()]
      .filter(
        ([key, expense]) =>
          key.startsWith(`${tenantId}:`) &&
          expense.incurredAt >= startDate &&
          expense.incurredAt <= endDate,
      )
      .map(([, expense]) => expense);
  }
}

export class InMemoryBudgetRepository implements BudgetRepository {
  private readonly store = new Map<string, Budget>();
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async save(budget: Budget, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(tenantKey(tenantId, budget.id.toString()), budget);
    await this.deps.outbox.write(budget.pullDomainEvents(), { ...this.deps.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Budget | null> {
    return this.store.get(tenantKey(tenantId, id)) ?? null;
  }

  async findByCostCenterAndPeriod(
    costCenterRef: string,
    period: string,
    tenantId: string,
  ): Promise<Budget | null> {
    return (
      [...this.store.entries()].find(
        ([key, budget]) =>
          key.startsWith(`${tenantId}:`) &&
          budget.costCenterRef === costCenterRef &&
          budget.period === period,
      )?.[1] ?? null
    );
  }
}

export class InMemoryExchangeRateRepository implements ExchangeRateRepository {
  private readonly rates: { readonly tenantId: string; readonly rate: ExchangeRate }[] = [];

  async add(rate: ExchangeRate, tenantId: string): Promise<void> {
    this.rates.push({ tenantId, rate });
  }

  async findEffective(
    baseCurrency: string,
    quoteCurrency: string,
    at: Date,
    tenantId: string,
  ): Promise<ExchangeRate | null> {
    const candidates = this.rates
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.rate.baseCurrency === baseCurrency &&
          row.rate.quoteCurrency === quoteCurrency &&
          row.rate.effectiveAt.getTime() <= at.getTime(),
      )
      .sort((a, b) => b.rate.effectiveAt.getTime() - a.rate.effectiveAt.getTime());
    return candidates[0]?.rate ?? null;
  }

  async list(
    baseCurrency: string,
    quoteCurrency: string,
    tenantId: string,
  ): Promise<readonly ExchangeRate[]> {
    return this.rates
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.rate.baseCurrency === baseCurrency &&
          row.rate.quoteCurrency === quoteCurrency,
      )
      .map((row) => row.rate);
  }
}

export class InMemoryFiscalPeriodRepository implements FiscalPeriodRepository {
  private readonly store = new Map<string, FiscalPeriod>();
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async save(period: FiscalPeriod, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(tenantKey(tenantId, period.id.toString()), period);
    await this.deps.outbox.write(period.pullDomainEvents(), { ...this.deps.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<FiscalPeriod | null> {
    return this.store.get(tenantKey(tenantId, id)) ?? null;
  }

  async findCurrent(at: Date, tenantId: string): Promise<FiscalPeriod | null> {
    return (
      [...this.store.entries()].find(
        ([key, period]) =>
          key.startsWith(`${tenantId}:`) && period.startDate <= at && period.endDate >= at,
      )?.[1] ?? null
    );
  }
}

export class InMemoryTaxProfileRepository implements TaxProfileRepository {
  private readonly store = new Map<string, TaxProfile>();

  async save(profile: TaxProfile, tenantId: string): Promise<void> {
    this.store.set(tenantKey(tenantId, profile.id.toString()), profile);
  }

  async findById(id: string, tenantId: string): Promise<TaxProfile | null> {
    return this.store.get(tenantKey(tenantId, id)) ?? null;
  }

  async findByJurisdiction(jurisdiction: string, tenantId: string): Promise<TaxProfile | null> {
    return (
      [...this.store.entries()].find(
        ([key, profile]) => key.startsWith(`${tenantId}:`) && profile.jurisdiction === jurisdiction,
      )?.[1] ?? null
    );
  }
}

export class InMemoryCogsSnapshotRepository implements CogsSnapshotRepository {
  private readonly snapshots: { readonly tenantId: string; readonly snapshot: CogsSnapshot }[] = [];

  async add(snapshot: CogsSnapshot, tenantId: string): Promise<void> {
    this.snapshots.push({ tenantId, snapshot });
  }

  async findEffective(
    productRef: string,
    at: Date,
    tenantId: string,
  ): Promise<CogsSnapshot | null> {
    const candidates = this.snapshots
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.snapshot.productRef === productRef &&
          row.snapshot.effectiveAt.getTime() <= at.getTime(),
      )
      .sort((a, b) => b.snapshot.effectiveAt.getTime() - a.snapshot.effectiveAt.getTime());
    return candidates[0]?.snapshot ?? null;
  }

  async list(productRef: string, tenantId: string): Promise<readonly CogsSnapshot[]> {
    return this.snapshots
      .filter((row) => row.tenantId === tenantId && row.snapshot.productRef === productRef)
      .map((row) => row.snapshot);
  }
}

export class InMemoryFinancialSnapshotRepository implements FinancialSnapshotRepository {
  private readonly store = new Map<string, FinancialSnapshot>();
  private readonly deps: OutboxBackedDeps;

  constructor(deps: OutboxBackedDeps) {
    this.deps = deps;
  }

  async save(snapshot: FinancialSnapshot, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(tenantKey(tenantId, snapshot.id.toString()), snapshot);
    await this.deps.outbox.write(
      snapshot.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      tx,
    );
  }

  async findById(id: string, tenantId: string): Promise<FinancialSnapshot | null> {
    return this.store.get(tenantKey(tenantId, id)) ?? null;
  }

  async findByPeriod(period: string, tenantId: string): Promise<FinancialSnapshot | null> {
    return (
      [...this.store.entries()].find(
        ([key, snapshot]) => key.startsWith(`${tenantId}:`) && snapshot.period === period,
      )?.[1] ?? null
    );
  }
}
