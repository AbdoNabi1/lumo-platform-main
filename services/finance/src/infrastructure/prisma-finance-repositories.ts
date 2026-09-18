import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
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
import type { TaxProfile } from "../domain/tax-profile";
import type { LedgerEntry } from "../domain/value-objects/ledger-entry";
import { FinanceMapper } from "./finance.mappers";

/**
 * ADR-0014 (WP-10 T10.3): built once, as a process-wide singleton — `tenantId` is a per-call
 * parameter on every repository method below, never captured here at construction.
 */
export interface PrismaFinanceDeps {
  readonly prisma: Database;
}

export interface PrismaJournalDeps extends PrismaFinanceDeps {
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Runs `run` against the caller's `tx` if given, else opens a tenant-scoped read transaction (ADR-0014 point 3). */
function readWith<T>(
  prisma: Database,
  tenantId: string,
  tx: unknown,
  run: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  return tx !== undefined && tx !== null
    ? run(tx as TransactionClient)
    : runReadScoped(prisma, tenantId, run);
}

function requireTx(tx: unknown, repoName: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(`${repoName} requires the unit of work's transaction client (ADR-0003).`);
  }
  return tx as TransactionClient;
}

/** Writes with no outbox append have no atomicity requirement — use the caller's `tx` if given, else the bare client. */
function client(prisma: Database, tx: unknown): Database | TransactionClient {
  return (tx as TransactionClient | undefined) ?? prisma;
}

/**
 * Production `journals`/`ledger_entries` (append-only ledger) repository, same-transaction
 * outbox per ADR-0003. `ShippingRateCard`/`ShippingRate`/`QuoteShippingRates` persistence:
 * none — out of the T1-Core frozen scope.
 */
export class PrismaJournalRepository implements JournalRepository, LedgerEntryRepository {
  private readonly deps: PrismaJournalDeps;
  constructor(deps: PrismaJournalDeps) {
    this.deps = deps;
  }

  async append(journal: Journal, tenantId: string, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaJournalRepository.append");
    await db.journal.create({ data: FinanceMapper.journalToRow(journal, tenantId) });
    const entries = FinanceMapper.ledgerEntryRows(journal, tenantId);
    if (entries.length > 0) {
      await db.ledgerEntry.createMany({ data: entries, skipDuplicates: true });
    }
    await this.deps.outbox.write(
      journal.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      db,
    );
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Journal | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.journal.findFirst({ where: { id, tenantId } });
      if (row === null) return null;
      const lines = await db.ledgerEntry.findMany({ where: { journalId: id, tenantId } });
      return FinanceMapper.journalToDomain(row, lines);
    });
  }

  async findBySourceRef(
    sourceRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Journal[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.journal.findMany({ where: { sourceRef, tenantId } });
      if (rows.length === 0) return [];

      // Phase A.15 (Task 8): was one `ledgerEntry.findMany` per journal row (N+1) — batched into a
      // single query keyed on all journal ids, then grouped back per-journal in memory.
      const allLines = await db.ledgerEntry.findMany({
        where: { journalId: { in: rows.map((row) => row.id) }, tenantId },
      });
      const linesByJournalId = new Map<string, typeof allLines>();
      for (const line of allLines) {
        const existing = linesByJournalId.get(line.journalId);
        if (existing === undefined) {
          linesByJournalId.set(line.journalId, [line]);
        } else {
          existing.push(line);
        }
      }

      return rows.map((row) =>
        FinanceMapper.journalToDomain(row, linesByJournalId.get(row.id) ?? []),
      );
    });
  }

  async findByAccount(
    accountRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly LedgerEntry[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.ledgerEntry.findMany({ where: { accountRef, tenantId } });
      return rows.map((row) => FinanceMapper.ledgerEntryToDomain(row));
    });
  }

  async findByPeriod(
    startDate: Date,
    endDate: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly LedgerEntry[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.ledgerEntry.findMany({
        where: { tenantId, postedAt: { gte: startDate, lte: endDate } },
      });
      return rows.map((row) => FinanceMapper.ledgerEntryToDomain(row));
    });
  }

  async list(tenantId: string, tx?: unknown): Promise<readonly LedgerEntry[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.ledgerEntry.findMany({ where: { tenantId } });
      return rows.map((row) => FinanceMapper.ledgerEntryToDomain(row));
    });
  }
}

export class PrismaAccountRepository implements AccountRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async save(account: Account, tenantId: string, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const id = account.id.toString();
    if (account.version === 0) {
      await db.account.create({
        data: { ...FinanceMapper.accountToRow(account, tenantId), version: 1 },
      });
      return;
    }
    const updated = await db.account.updateMany({
      where: { id, tenantId, version: account.version },
      data: { name: account.name, active: account.active, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(
        `Account ${id} was modified concurrently (expected version ${account.version})`,
      );
    }
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Account | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.account.findFirst({ where: { id, tenantId } });
      return row === null ? null : FinanceMapper.accountToDomain(row);
    });
  }

  async findByCode(code: string, tenantId: string, tx?: unknown): Promise<Account | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.account.findFirst({ where: { code, tenantId } });
      return row === null ? null : FinanceMapper.accountToDomain(row);
    });
  }

  async list(tenantId: string, tx?: unknown): Promise<readonly Account[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.account.findMany({ where: { tenantId } });
      return rows.map((row) => FinanceMapper.accountToDomain(row));
    });
  }
}

export class PrismaCostCenterRepository implements CostCenterRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async save(costCenter: CostCenter, tenantId: string, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const id = costCenter.id.toString();
    if (costCenter.version === 0) {
      await db.costCenter.create({
        data: { ...FinanceMapper.costCenterToRow(costCenter, tenantId), version: 1 },
      });
      return;
    }
    const updated = await db.costCenter.updateMany({
      where: { id, tenantId, version: costCenter.version },
      data: { name: costCenter.name, active: costCenter.active, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(
        `CostCenter ${id} was modified concurrently (expected version ${costCenter.version})`,
      );
    }
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<CostCenter | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.costCenter.findFirst({ where: { id, tenantId } });
      return row === null ? null : FinanceMapper.costCenterToDomain(row);
    });
  }

  async list(tenantId: string, tx?: unknown): Promise<readonly CostCenter[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.costCenter.findMany({ where: { tenantId } });
      return rows.map((row) => FinanceMapper.costCenterToDomain(row));
    });
  }
}

export class PrismaExpenseCategoryRepository implements ExpenseCategoryRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async save(category: ExpenseCategory, tenantId: string, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const id = category.id.toString();
    if (category.version === 0) {
      await db.expenseCategory.create({
        data: { ...FinanceMapper.expenseCategoryToRow(category, tenantId), version: 1 },
      });
      return;
    }
    const updated = await db.expenseCategory.updateMany({
      where: { id, tenantId, version: category.version },
      data: { name: category.name, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(
        `ExpenseCategory ${id} was modified concurrently (expected version ${category.version})`,
      );
    }
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<ExpenseCategory | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.expenseCategory.findFirst({ where: { id, tenantId } });
      return row === null ? null : FinanceMapper.expenseCategoryToDomain(row);
    });
  }

  async list(tenantId: string, tx?: unknown): Promise<readonly ExpenseCategory[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.expenseCategory.findMany({ where: { tenantId } });
      return rows.map((row) => FinanceMapper.expenseCategoryToDomain(row));
    });
  }
}

export interface PrismaOutboxDeps extends PrismaFinanceDeps {
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

export class PrismaExpenseRepository implements ExpenseRepository {
  private readonly deps: PrismaOutboxDeps;
  constructor(deps: PrismaOutboxDeps) {
    this.deps = deps;
  }

  async save(expense: Expense, tenantId: string, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaExpenseRepository.save");
    await db.expense.create({ data: FinanceMapper.expenseToRow(expense, tenantId) });
    await this.deps.outbox.write(
      expense.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      db,
    );
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Expense | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.expense.findFirst({ where: { id, tenantId } });
      return row === null ? null : FinanceMapper.expenseToDomain(row);
    });
  }

  async findByPeriod(
    startDate: Date,
    endDate: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly Expense[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.expense.findMany({
        where: { tenantId, incurredAt: { gte: startDate, lte: endDate } },
      });
      return rows.map((row) => FinanceMapper.expenseToDomain(row));
    });
  }
}

export class PrismaBudgetRepository implements BudgetRepository {
  private readonly deps: PrismaOutboxDeps;
  constructor(deps: PrismaOutboxDeps) {
    this.deps = deps;
  }

  async save(budget: Budget, tenantId: string, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaBudgetRepository.save");
    const id = budget.id.toString();
    if (budget.version === 0) {
      await db.budget.create({
        data: { ...FinanceMapper.budgetToRow(budget, tenantId), version: 1 },
      });
    } else {
      const updated = await db.budget.updateMany({
        where: { id, tenantId, version: budget.version },
        data: {
          amountMinor: budget.amount.amountMinor,
          revisions: budget.revisions,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Budget ${id} was modified concurrently (expected version ${budget.version})`,
        );
      }
    }
    await this.deps.outbox.write(budget.pullDomainEvents(), { ...this.deps.context, tenantId }, db);
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Budget | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.budget.findFirst({ where: { id, tenantId } });
      return row === null ? null : FinanceMapper.budgetToDomain(row);
    });
  }

  async findByCostCenterAndPeriod(
    costCenterRef: string,
    period: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Budget | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.budget.findFirst({ where: { costCenterRef, period, tenantId } });
      return row === null ? null : FinanceMapper.budgetToDomain(row);
    });
  }
}

export class PrismaExchangeRateRepository implements ExchangeRateRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async add(rate: ExchangeRate, tenantId: string, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    await db.exchangeRate.create({ data: FinanceMapper.exchangeRateToRow(rate, tenantId) });
  }

  async findEffective(
    baseCurrency: string,
    quoteCurrency: string,
    at: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<ExchangeRate | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.exchangeRate.findFirst({
        where: { baseCurrency, quoteCurrency, tenantId, effectiveAt: { lte: at } },
        orderBy: { effectiveAt: "desc" },
      });
      return row === null ? null : FinanceMapper.exchangeRateToDomain(row);
    });
  }

  async list(
    baseCurrency: string,
    quoteCurrency: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly ExchangeRate[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.exchangeRate.findMany({
        where: { baseCurrency, quoteCurrency, tenantId },
      });
      return rows.map((row) => FinanceMapper.exchangeRateToDomain(row));
    });
  }
}

export class PrismaFiscalPeriodRepository implements FiscalPeriodRepository {
  private readonly deps: PrismaOutboxDeps;
  constructor(deps: PrismaOutboxDeps) {
    this.deps = deps;
  }

  async save(period: FiscalPeriod, tenantId: string, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaFiscalPeriodRepository.save");
    const id = period.id.toString();
    if (period.version === 0) {
      await db.fiscalPeriod.create({
        data: { ...FinanceMapper.fiscalPeriodToRow(period, tenantId), version: 1 },
      });
    } else {
      const updated = await db.fiscalPeriod.updateMany({
        where: { id, tenantId, version: period.version },
        data: { closed: period.closed, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `FiscalPeriod ${id} was modified concurrently (expected version ${period.version})`,
        );
      }
    }
    await this.deps.outbox.write(period.pullDomainEvents(), { ...this.deps.context, tenantId }, db);
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<FiscalPeriod | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.fiscalPeriod.findFirst({ where: { id, tenantId } });
      return row === null ? null : FinanceMapper.fiscalPeriodToDomain(row);
    });
  }

  async findCurrent(at: Date, tenantId: string, tx?: unknown): Promise<FiscalPeriod | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.fiscalPeriod.findFirst({
        where: { tenantId, startDate: { lte: at }, endDate: { gte: at } },
      });
      return row === null ? null : FinanceMapper.fiscalPeriodToDomain(row);
    });
  }
}

export class PrismaTaxProfileRepository implements TaxProfileRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async save(profile: TaxProfile, tenantId: string, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const id = profile.id.toString();
    if (profile.version === 0) {
      await db.taxProfile.create({
        data: { ...FinanceMapper.taxProfileToRow(profile, tenantId), version: 1 },
      });
      return;
    }
    const updated = await db.taxProfile.updateMany({
      where: { id, tenantId, version: profile.version },
      data: {
        rates: profile.rates.map((r) => ({ basisPoints: r.basisPoints })),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(
        `TaxProfile ${id} was modified concurrently (expected version ${profile.version})`,
      );
    }
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<TaxProfile | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.taxProfile.findFirst({ where: { id, tenantId } });
      return row === null ? null : FinanceMapper.taxProfileToDomain(row);
    });
  }

  async findByJurisdiction(
    jurisdiction: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<TaxProfile | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.taxProfile.findFirst({ where: { jurisdiction, tenantId } });
      return row === null ? null : FinanceMapper.taxProfileToDomain(row);
    });
  }
}

export class PrismaCogsSnapshotRepository implements CogsSnapshotRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async add(snapshot: CogsSnapshot, tenantId: string, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const currency = snapshot.components[0]?.amount.currency ?? "USD";
    await db.cogsSnapshot.create({
      data: FinanceMapper.cogsSnapshotToRow(snapshot, tenantId, currency),
    });
  }

  async findEffective(
    productRef: string,
    at: Date,
    tenantId: string,
    tx?: unknown,
  ): Promise<CogsSnapshot | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.cogsSnapshot.findFirst({
        where: { productRef, tenantId, effectiveAt: { lte: at } },
        orderBy: { effectiveAt: "desc" },
      });
      return row === null ? null : FinanceMapper.cogsSnapshotToDomain(row);
    });
  }

  async list(productRef: string, tenantId: string, tx?: unknown): Promise<readonly CogsSnapshot[]> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const rows = await db.cogsSnapshot.findMany({ where: { productRef, tenantId } });
      return rows.map((row) => FinanceMapper.cogsSnapshotToDomain(row));
    });
  }
}

export class PrismaFinancialSnapshotRepository implements FinancialSnapshotRepository {
  private readonly deps: PrismaOutboxDeps;
  constructor(deps: PrismaOutboxDeps) {
    this.deps = deps;
  }

  /** Upsert by `(tenantId, period)` — rebuild is idempotent, materialised in place (M6). */
  async save(snapshot: FinancialSnapshot, tenantId: string, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaFinancialSnapshotRepository.save");
    const row = FinanceMapper.financialSnapshotToRow(snapshot, tenantId);
    await db.financialSnapshot.upsert({
      where: { tenantId_period: { tenantId, period: snapshot.period } },
      create: row,
      update: { figures: row.figures },
    });
    await this.deps.outbox.write(
      snapshot.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      db,
    );
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<FinancialSnapshot | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.financialSnapshot.findFirst({ where: { id, tenantId } });
      return row === null ? null : FinanceMapper.financialSnapshotToDomain(row);
    });
  }

  async findByPeriod(
    period: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<FinancialSnapshot | null> {
    return readWith(this.deps.prisma, tenantId, tx, async (db) => {
      const row = await db.financialSnapshot.findFirst({ where: { period, tenantId } });
      return row === null ? null : FinanceMapper.financialSnapshotToDomain(row);
    });
  }
}
