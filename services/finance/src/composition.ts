import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import {
  CreateBudget,
  GenerateForecast,
  RecordExpense,
  RecordManualAdjustment,
  ReviseBudget,
} from "./application/ledger.commands";
import {
  CloseFiscalPeriod,
  OpenFiscalPeriod,
  SetExchangeRate,
} from "./application/fiscal.commands";
import {
  CreateAccount,
  CreateCostCenter,
  CreateExpenseCategory,
  DefineTaxProfile,
  SetProductCost,
} from "./application/reference-data.commands";
import { BalanceSheetQuery, IncomeStatementQuery, TrialBalanceQuery } from "./application/queries";
import { GetReadModel, ListReadModel, QueryReadModel } from "./application/read-model.queries";
import type {
  AccountRepository,
  BudgetRepository,
  CogsSnapshotRepository,
  CostCenterRepository,
  ExchangeRateRepository,
  ExpenseCategoryRepository,
  ExpenseRepository,
  FiscalPeriodRepository,
  JournalRepository,
  LedgerEntryRepository,
  TaxProfileRepository,
} from "./domain/repositories";
import type { PostingAccounts } from "./domain/services/ledger-poster";
import { FinanceController } from "./interfaces/finance.controller";
import { FinanceEventTranslator } from "./infrastructure/finance-event-translator";
import { InMemoryAiForecast } from "./infrastructure/in-memory-ai-forecast";
import { InMemoryReadModelStore } from "./infrastructure/in-memory-read-model-store";
import { InMemorySecurity } from "./infrastructure/in-memory-security";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  InMemoryAccountRepository,
  InMemoryBudgetRepository,
  InMemoryCogsSnapshotRepository,
  InMemoryCostCenterRepository,
  InMemoryExchangeRateRepository,
  InMemoryExpenseCategoryRepository,
  InMemoryExpenseRepository,
  InMemoryFiscalPeriodRepository,
  InMemoryJournalRepository,
  InMemoryTaxProfileRepository,
} from "./infrastructure/in-memory-repositories";
import {
  PrismaAccountRepository,
  PrismaBudgetRepository,
  PrismaCogsSnapshotRepository,
  PrismaCostCenterRepository,
  PrismaExchangeRateRepository,
  PrismaExpenseCategoryRepository,
  PrismaExpenseRepository,
  PrismaFiscalPeriodRepository,
  PrismaJournalRepository,
  PrismaTaxProfileRepository,
} from "./infrastructure/prisma-finance-repositories";

export interface FinanceWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Chart-of-accounts references `LedgerPoster`'s commerce-event templates post to. */
  readonly postingAccounts: PostingAccounts;
  /**
   * Production persistence. Present ⇒ Prisma slice (all ten repositories below, same
   * `prisma?`/`tenantId?`-presence convention as `wireFeatureRegistry`/`wireCustomer360`); absent
   * ⇒ in-memory. `security`/`forecast`/`readModels` stay in-memory in both branches — no Prisma
   * counterpart exists for these (Security/AiForecast are stub/policy concerns, not ledger data;
   * the read-model store's only durable backing is ClickHouse, gated separately and untouched
   * here).
   */
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Finance table is tenant-scoped. */
  readonly tenantId?: string;
}

export interface WiredFinance {
  readonly finance: FinanceController;
  readonly security: InMemorySecurity;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

interface FinanceRepos {
  readonly journals: JournalRepository & LedgerEntryRepository;
  readonly accounts: AccountRepository;
  readonly costCenters: CostCenterRepository;
  readonly expenseCategories: ExpenseCategoryRepository;
  readonly expenses: ExpenseRepository;
  readonly budgets: BudgetRepository;
  readonly exchangeRates: ExchangeRateRepository;
  readonly fiscalPeriods: FiscalPeriodRepository;
  readonly taxProfiles: TaxProfileRepository;
  readonly cogsSnapshots: CogsSnapshotRepository;
}

/** Builds the `FinanceController` from an already-wired repo set — shared by both the in-memory and Prisma branches so the (large) use-case wiring is written exactly once. */
function buildController(
  repos: FinanceRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  security: InMemorySecurity,
  forecast: InMemoryAiForecast,
  readModels: InMemoryReadModelStore,
  deps: FinanceWiringDeps,
): FinanceController {
  const referenceDataDeps = {
    accounts: repos.accounts,
    costCenters: repos.costCenters,
    expenseCategories: repos.expenseCategories,
    taxProfiles: repos.taxProfiles,
    cogsSnapshots: repos.cogsSnapshots,
    unitOfWork,
    security,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const fiscalDeps = {
    fiscalPeriods: repos.fiscalPeriods,
    exchangeRates: repos.exchangeRates,
    unitOfWork,
    security,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const ledgerDeps = {
    expenses: repos.expenses,
    budgets: repos.budgets,
    journals: repos.journals,
    forecast,
    unitOfWork,
    security,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const queryDeps = {
    accounts: repos.accounts,
    ledgerEntries: repos.journals,
    security,
    clock: deps.clock,
  };
  const readModelDeps = { readModels, security, clock: deps.clock };

  return new FinanceController({
    createAccount: new CreateAccount(referenceDataDeps),
    createCostCenter: new CreateCostCenter(referenceDataDeps),
    createExpenseCategory: new CreateExpenseCategory(referenceDataDeps),
    defineTaxProfile: new DefineTaxProfile(referenceDataDeps),
    setProductCost: new SetProductCost(referenceDataDeps),
    openFiscalPeriod: new OpenFiscalPeriod(fiscalDeps),
    closeFiscalPeriod: new CloseFiscalPeriod(fiscalDeps),
    setExchangeRate: new SetExchangeRate(fiscalDeps),
    recordExpense: new RecordExpense(ledgerDeps),
    createBudget: new CreateBudget(ledgerDeps),
    reviseBudget: new ReviseBudget(ledgerDeps),
    recordManualAdjustment: new RecordManualAdjustment(ledgerDeps),
    generateForecast: new GenerateForecast(ledgerDeps),
    trialBalanceQuery: new TrialBalanceQuery(queryDeps),
    incomeStatementQuery: new IncomeStatementQuery(queryDeps),
    balanceSheetQuery: new BalanceSheetQuery(queryDeps),
    getReadModel: new GetReadModel(readModelDeps),
    listReadModel: new ListReadModel(readModelDeps),
    queryReadModel: new QueryReadModel(readModelDeps),
  });
}

/** Composition root for the Finance context. Prisma slice when `prisma` is present; else in-memory. */
export function wireFinance(deps: FinanceWiringDeps): WiredFinance {
  const security = new InMemorySecurity();
  const forecast = new InMemoryAiForecast();
  const readModels = new InMemoryReadModelStore();

  if (deps.prisma !== undefined) {
    const tenantId = deps.tenantId;
    if (tenantId === undefined) {
      throw new Error("wireFinance: tenantId is required when prisma is provided (ADR-0008).");
    }
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator: new FinanceEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "finance",
    });
    const context = rootEventContext(deps.idGenerator, tenantId);
    const financeDeps = { prisma: deps.prisma, tenantId };
    const outboxDeps = { ...financeDeps, outbox, context };

    const repos: FinanceRepos = {
      journals: new PrismaJournalRepository(outboxDeps),
      accounts: new PrismaAccountRepository(financeDeps),
      costCenters: new PrismaCostCenterRepository(financeDeps),
      expenseCategories: new PrismaExpenseCategoryRepository(financeDeps),
      expenses: new PrismaExpenseRepository(outboxDeps),
      budgets: new PrismaBudgetRepository(outboxDeps),
      exchangeRates: new PrismaExchangeRateRepository(financeDeps),
      fiscalPeriods: new PrismaFiscalPeriodRepository(outboxDeps),
      taxProfiles: new PrismaTaxProfileRepository(financeDeps),
      cogsSnapshots: new PrismaCogsSnapshotRepository(financeDeps),
    };

    return {
      finance: buildController(
        repos,
        new PrismaUnitOfWork(deps.prisma),
        security,
        forecast,
        readModels,
        deps,
      ),
      security,
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const outboxStore = new InMemoryOutboxStore();
  const outboxWriter = new OutboxWriter({
    store: outboxStore,
    translator: new FinanceEventTranslator(),
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "finance",
  });
  const context = rootEventContext(deps.idGenerator);
  const outboxDeps = { outbox: outboxWriter, context };

  const repos: FinanceRepos = {
    journals: new InMemoryJournalRepository(outboxDeps),
    accounts: new InMemoryAccountRepository(),
    costCenters: new InMemoryCostCenterRepository(),
    expenseCategories: new InMemoryExpenseCategoryRepository(),
    expenses: new InMemoryExpenseRepository(outboxDeps),
    budgets: new InMemoryBudgetRepository(outboxDeps),
    exchangeRates: new InMemoryExchangeRateRepository(),
    fiscalPeriods: new InMemoryFiscalPeriodRepository(outboxDeps),
    taxProfiles: new InMemoryTaxProfileRepository(),
    cogsSnapshots: new InMemoryCogsSnapshotRepository(),
  };

  const unitOfWork = new InMemoryUnitOfWork();
  const controller = buildController(repos, unitOfWork, security, forecast, readModels, deps);

  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const type of [
    "finance.ledger.posted",
    "finance.expense.created",
    "finance.budget.updated",
    "finance.period.closed",
    "finance.snapshot.created",
    "finance.statement.generated",
    "finance.cashflow.updated",
    "finance.tax.calculated",
  ]) {
    bus.subscribe(`${type}.v1`, sink);
  }

  const relay = new OutboxRelay({
    store: outboxStore,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });

  return {
    finance: controller,
    security,
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
