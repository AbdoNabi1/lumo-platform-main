import type { Database, TransactionClient } from "@platform/db";
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

export interface PrismaFinanceDeps {
  readonly prisma: Database;
  readonly tenantId: string;
}

export interface PrismaJournalDeps extends PrismaFinanceDeps {
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

function client(prisma: Database, tx: unknown): Database | TransactionClient {
  return (tx as TransactionClient | undefined) ?? prisma;
}

function requireTx(tx: unknown, repoName: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(`${repoName} requires the unit of work's transaction client (ADR-0003).`);
  }
  return tx as TransactionClient;
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

  async append(journal: Journal, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaJournalRepository.append");
    await db.journal.create({ data: FinanceMapper.journalToRow(journal, this.deps.tenantId) });
    const entries = FinanceMapper.ledgerEntryRows(journal, this.deps.tenantId);
    if (entries.length > 0) {
      await db.ledgerEntry.createMany({ data: entries, skipDuplicates: true });
    }
    await this.deps.outbox.write(journal.pullDomainEvents(), this.deps.context, db);
  }

  async findById(id: string, tx?: unknown): Promise<Journal | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.journal.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    const lines = await db.ledgerEntry.findMany({
      where: { journalId: id, tenantId: this.deps.tenantId },
    });
    return FinanceMapper.journalToDomain(row, lines);
  }

  async findBySourceRef(sourceRef: string, tx?: unknown): Promise<readonly Journal[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.journal.findMany({ where: { sourceRef, tenantId: this.deps.tenantId } });
    if (rows.length === 0) return [];

    // Phase A.15 (Task 8): was one `ledgerEntry.findMany` per journal row (N+1) — batched into a
    // single query keyed on all journal ids, then grouped back per-journal in memory.
    const allLines = await db.ledgerEntry.findMany({
      where: { journalId: { in: rows.map((row) => row.id) }, tenantId: this.deps.tenantId },
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
  }

  async findByAccount(accountRef: string, tx?: unknown): Promise<readonly LedgerEntry[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.ledgerEntry.findMany({
      where: { accountRef, tenantId: this.deps.tenantId },
    });
    return rows.map((row) => FinanceMapper.ledgerEntryToDomain(row));
  }

  async findByPeriod(
    startDate: Date,
    endDate: Date,
    tx?: unknown,
  ): Promise<readonly LedgerEntry[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.ledgerEntry.findMany({
      where: { tenantId: this.deps.tenantId, postedAt: { gte: startDate, lte: endDate } },
    });
    return rows.map((row) => FinanceMapper.ledgerEntryToDomain(row));
  }

  async list(tx?: unknown): Promise<readonly LedgerEntry[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.ledgerEntry.findMany({ where: { tenantId: this.deps.tenantId } });
    return rows.map((row) => FinanceMapper.ledgerEntryToDomain(row));
  }
}

export class PrismaAccountRepository implements AccountRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async save(account: Account, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const id = account.id.toString();
    if (account.version === 0) {
      await db.account.create({
        data: { ...FinanceMapper.accountToRow(account, this.deps.tenantId), version: 1 },
      });
      return;
    }
    const updated = await db.account.updateMany({
      where: { id, tenantId: this.deps.tenantId, version: account.version },
      data: { name: account.name, active: account.active, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(
        `Account ${id} was modified concurrently (expected version ${account.version})`,
      );
    }
  }

  async findById(id: string, tx?: unknown): Promise<Account | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.account.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : FinanceMapper.accountToDomain(row);
  }

  async findByCode(code: string, tx?: unknown): Promise<Account | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.account.findFirst({ where: { code, tenantId: this.deps.tenantId } });
    return row === null ? null : FinanceMapper.accountToDomain(row);
  }

  async list(tx?: unknown): Promise<readonly Account[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.account.findMany({ where: { tenantId: this.deps.tenantId } });
    return rows.map((row) => FinanceMapper.accountToDomain(row));
  }
}

export class PrismaCostCenterRepository implements CostCenterRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async save(costCenter: CostCenter, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const id = costCenter.id.toString();
    if (costCenter.version === 0) {
      await db.costCenter.create({
        data: { ...FinanceMapper.costCenterToRow(costCenter, this.deps.tenantId), version: 1 },
      });
      return;
    }
    const updated = await db.costCenter.updateMany({
      where: { id, tenantId: this.deps.tenantId, version: costCenter.version },
      data: { name: costCenter.name, active: costCenter.active, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(
        `CostCenter ${id} was modified concurrently (expected version ${costCenter.version})`,
      );
    }
  }

  async findById(id: string, tx?: unknown): Promise<CostCenter | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.costCenter.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : FinanceMapper.costCenterToDomain(row);
  }

  async list(tx?: unknown): Promise<readonly CostCenter[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.costCenter.findMany({ where: { tenantId: this.deps.tenantId } });
    return rows.map((row) => FinanceMapper.costCenterToDomain(row));
  }
}

export class PrismaExpenseCategoryRepository implements ExpenseCategoryRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async save(category: ExpenseCategory, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const id = category.id.toString();
    if (category.version === 0) {
      await db.expenseCategory.create({
        data: { ...FinanceMapper.expenseCategoryToRow(category, this.deps.tenantId), version: 1 },
      });
      return;
    }
    const updated = await db.expenseCategory.updateMany({
      where: { id, tenantId: this.deps.tenantId, version: category.version },
      data: { name: category.name, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new ConcurrencyError(
        `ExpenseCategory ${id} was modified concurrently (expected version ${category.version})`,
      );
    }
  }

  async findById(id: string, tx?: unknown): Promise<ExpenseCategory | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.expenseCategory.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : FinanceMapper.expenseCategoryToDomain(row);
  }

  async list(tx?: unknown): Promise<readonly ExpenseCategory[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.expenseCategory.findMany({ where: { tenantId: this.deps.tenantId } });
    return rows.map((row) => FinanceMapper.expenseCategoryToDomain(row));
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

  async save(expense: Expense, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaExpenseRepository.save");
    await db.expense.create({ data: FinanceMapper.expenseToRow(expense, this.deps.tenantId) });
    await this.deps.outbox.write(expense.pullDomainEvents(), this.deps.context, db);
  }

  async findById(id: string, tx?: unknown): Promise<Expense | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.expense.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : FinanceMapper.expenseToDomain(row);
  }

  async findByPeriod(startDate: Date, endDate: Date, tx?: unknown): Promise<readonly Expense[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.expense.findMany({
      where: { tenantId: this.deps.tenantId, incurredAt: { gte: startDate, lte: endDate } },
    });
    return rows.map((row) => FinanceMapper.expenseToDomain(row));
  }
}

export class PrismaBudgetRepository implements BudgetRepository {
  private readonly deps: PrismaOutboxDeps;
  constructor(deps: PrismaOutboxDeps) {
    this.deps = deps;
  }

  async save(budget: Budget, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaBudgetRepository.save");
    const id = budget.id.toString();
    if (budget.version === 0) {
      await db.budget.create({
        data: { ...FinanceMapper.budgetToRow(budget, this.deps.tenantId), version: 1 },
      });
    } else {
      const updated = await db.budget.updateMany({
        where: { id, tenantId: this.deps.tenantId, version: budget.version },
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
    await this.deps.outbox.write(budget.pullDomainEvents(), this.deps.context, db);
  }

  async findById(id: string, tx?: unknown): Promise<Budget | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.budget.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : FinanceMapper.budgetToDomain(row);
  }

  async findByCostCenterAndPeriod(
    costCenterRef: string,
    period: string,
    tx?: unknown,
  ): Promise<Budget | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.budget.findFirst({
      where: { costCenterRef, period, tenantId: this.deps.tenantId },
    });
    return row === null ? null : FinanceMapper.budgetToDomain(row);
  }
}

export class PrismaExchangeRateRepository implements ExchangeRateRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async add(rate: ExchangeRate, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    await db.exchangeRate.create({
      data: FinanceMapper.exchangeRateToRow(rate, this.deps.tenantId),
    });
  }

  async findEffective(
    baseCurrency: string,
    quoteCurrency: string,
    at: Date,
    tx?: unknown,
  ): Promise<ExchangeRate | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.exchangeRate.findFirst({
      where: {
        baseCurrency,
        quoteCurrency,
        tenantId: this.deps.tenantId,
        effectiveAt: { lte: at },
      },
      orderBy: { effectiveAt: "desc" },
    });
    return row === null ? null : FinanceMapper.exchangeRateToDomain(row);
  }

  async list(
    baseCurrency: string,
    quoteCurrency: string,
    tx?: unknown,
  ): Promise<readonly ExchangeRate[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.exchangeRate.findMany({
      where: { baseCurrency, quoteCurrency, tenantId: this.deps.tenantId },
    });
    return rows.map((row) => FinanceMapper.exchangeRateToDomain(row));
  }
}

export class PrismaFiscalPeriodRepository implements FiscalPeriodRepository {
  private readonly deps: PrismaOutboxDeps;
  constructor(deps: PrismaOutboxDeps) {
    this.deps = deps;
  }

  async save(period: FiscalPeriod, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaFiscalPeriodRepository.save");
    const id = period.id.toString();
    if (period.version === 0) {
      await db.fiscalPeriod.create({
        data: { ...FinanceMapper.fiscalPeriodToRow(period, this.deps.tenantId), version: 1 },
      });
    } else {
      const updated = await db.fiscalPeriod.updateMany({
        where: { id, tenantId: this.deps.tenantId, version: period.version },
        data: { closed: period.closed, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `FiscalPeriod ${id} was modified concurrently (expected version ${period.version})`,
        );
      }
    }
    await this.deps.outbox.write(period.pullDomainEvents(), this.deps.context, db);
  }

  async findById(id: string, tx?: unknown): Promise<FiscalPeriod | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.fiscalPeriod.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : FinanceMapper.fiscalPeriodToDomain(row);
  }

  async findCurrent(at: Date, tx?: unknown): Promise<FiscalPeriod | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.fiscalPeriod.findFirst({
      where: { tenantId: this.deps.tenantId, startDate: { lte: at }, endDate: { gte: at } },
    });
    return row === null ? null : FinanceMapper.fiscalPeriodToDomain(row);
  }
}

export class PrismaTaxProfileRepository implements TaxProfileRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async save(profile: TaxProfile, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const id = profile.id.toString();
    if (profile.version === 0) {
      await db.taxProfile.create({
        data: { ...FinanceMapper.taxProfileToRow(profile, this.deps.tenantId), version: 1 },
      });
      return;
    }
    const updated = await db.taxProfile.updateMany({
      where: { id, tenantId: this.deps.tenantId, version: profile.version },
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

  async findById(id: string, tx?: unknown): Promise<TaxProfile | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.taxProfile.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : FinanceMapper.taxProfileToDomain(row);
  }

  async findByJurisdiction(jurisdiction: string, tx?: unknown): Promise<TaxProfile | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.taxProfile.findFirst({
      where: { jurisdiction, tenantId: this.deps.tenantId },
    });
    return row === null ? null : FinanceMapper.taxProfileToDomain(row);
  }
}

export class PrismaCogsSnapshotRepository implements CogsSnapshotRepository {
  private readonly deps: PrismaFinanceDeps;
  constructor(deps: PrismaFinanceDeps) {
    this.deps = deps;
  }

  async add(snapshot: CogsSnapshot, tx?: unknown): Promise<void> {
    const db = client(this.deps.prisma, tx);
    const currency = snapshot.components[0]?.amount.currency ?? "USD";
    await db.cogsSnapshot.create({
      data: FinanceMapper.cogsSnapshotToRow(snapshot, this.deps.tenantId, currency),
    });
  }

  async findEffective(productRef: string, at: Date, tx?: unknown): Promise<CogsSnapshot | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.cogsSnapshot.findFirst({
      where: { productRef, tenantId: this.deps.tenantId, effectiveAt: { lte: at } },
      orderBy: { effectiveAt: "desc" },
    });
    return row === null ? null : FinanceMapper.cogsSnapshotToDomain(row);
  }

  async list(productRef: string, tx?: unknown): Promise<readonly CogsSnapshot[]> {
    const db = client(this.deps.prisma, tx);
    const rows = await db.cogsSnapshot.findMany({
      where: { productRef, tenantId: this.deps.tenantId },
    });
    return rows.map((row) => FinanceMapper.cogsSnapshotToDomain(row));
  }
}

export class PrismaFinancialSnapshotRepository implements FinancialSnapshotRepository {
  private readonly deps: PrismaOutboxDeps;
  constructor(deps: PrismaOutboxDeps) {
    this.deps = deps;
  }

  /** Upsert by `(tenantId, period)` — rebuild is idempotent, materialised in place (M6). */
  async save(snapshot: FinancialSnapshot, tx?: unknown): Promise<void> {
    const db = requireTx(tx, "PrismaFinancialSnapshotRepository.save");
    const row = FinanceMapper.financialSnapshotToRow(snapshot, this.deps.tenantId);
    await db.financialSnapshot.upsert({
      where: { tenantId_period: { tenantId: this.deps.tenantId, period: snapshot.period } },
      create: row,
      update: { figures: row.figures },
    });
    await this.deps.outbox.write(snapshot.pullDomainEvents(), this.deps.context, db);
  }

  async findById(id: string, tx?: unknown): Promise<FinancialSnapshot | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.financialSnapshot.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    return row === null ? null : FinanceMapper.financialSnapshotToDomain(row);
  }

  async findByPeriod(period: string, tx?: unknown): Promise<FinancialSnapshot | null> {
    const db = client(this.deps.prisma, tx);
    const row = await db.financialSnapshot.findFirst({
      where: { period, tenantId: this.deps.tenantId },
    });
    return row === null ? null : FinanceMapper.financialSnapshotToDomain(row);
  }
}
