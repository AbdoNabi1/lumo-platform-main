import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { Money, UniqueEntityId, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { NotFoundError, type DomainError } from "@platform/utils";
import { Budget } from "../domain/budget";
import { Expense } from "../domain/expense";
import { Journal } from "../domain/journal";
import { JournalLine } from "../domain/value-objects/journal-line";
import { LedgerDirection } from "../domain/value-objects/ledger-direction";
import type {
  BudgetRepository,
  ExpenseRepository,
  JournalRepository,
} from "../domain/repositories";
import type { AiForecastPort, ForecastProposal, SecurityPort } from "./ports";
import { authorize } from "./authorize";

export interface LedgerCommandDeps {
  readonly expenses: ExpenseRepository;
  readonly budgets: BudgetRepository;
  readonly journals: JournalRepository;
  readonly forecast: AiForecastPort;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly security: SecurityPort;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface RecordExpenseInput {
  readonly principal: Principal;
  readonly tenantId: string;
  readonly costCenterRef: string;
  readonly categoryRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly description: string;
  readonly incurredAt: Date;
}

/** `RecordExpense` — records a merchant-entered {@link Expense}. */
export class RecordExpense implements UseCase<RecordExpenseInput, { expenseId: string }> {
  private readonly deps: LedgerCommandDeps;
  constructor(deps: LedgerCommandDeps) {
    this.deps = deps;
  }

  async execute(input: RecordExpenseInput): Promise<Result<{ expenseId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:manage", now, {
      action: "RecordExpense",
    });
    if (!authz.ok) return err(authz.error);

    const amount = Money.create(input.amountMinor, input.currency);
    if (!amount.ok) return err(amount.error);

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    const eventId = this.deps.idGenerator.generate();
    const expense = Expense.record(
      id,
      input.costCenterRef,
      input.categoryRef,
      amount.value,
      input.description,
      input.incurredAt,
      eventId,
      now,
    );

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.expenses.save(expense, input.tenantId, tx);
      return ok({ expenseId: expense.id.toString() });
    });
  }
}

export interface CreateBudgetInput {
  readonly principal: Principal;
  readonly tenantId: string;
  readonly costCenterRef: string;
  readonly period: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/** `CreateBudget` — plans a spend for a cost center/period. */
export class CreateBudget implements UseCase<CreateBudgetInput, { budgetId: string }> {
  private readonly deps: LedgerCommandDeps;
  constructor(deps: LedgerCommandDeps) {
    this.deps = deps;
  }

  async execute(input: CreateBudgetInput): Promise<Result<{ budgetId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:manage", now, {
      action: "CreateBudget",
    });
    if (!authz.ok) return err(authz.error);

    const amount = Money.create(input.amountMinor, input.currency);
    if (!amount.ok) return err(amount.error);

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    const budget = Budget.create(
      id,
      input.costCenterRef,
      input.period,
      amount.value,
      this.deps.idGenerator.generate(),
      now,
    );

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.budgets.save(budget, input.tenantId, tx);
      return ok({ budgetId: budget.id.toString() });
    });
  }
}

export interface ReviseBudgetInput {
  readonly principal: Principal;
  readonly tenantId: string;
  readonly budgetId: string;
  readonly amountMinor: number;
}

/** `ReviseBudget` — revises a previously created budget's amount. */
export class ReviseBudget implements UseCase<
  ReviseBudgetInput,
  { budgetId: string; revisions: number }
> {
  private readonly deps: LedgerCommandDeps;
  constructor(deps: LedgerCommandDeps) {
    this.deps = deps;
  }

  async execute(
    input: ReviseBudgetInput,
  ): Promise<Result<{ budgetId: string; revisions: number }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:manage", now, {
      action: "ReviseBudget",
      budgetId: input.budgetId,
    });
    if (!authz.ok) return err(authz.error);

    return this.deps.unitOfWork.run(async (tx) => {
      const budget = await this.deps.budgets.findById(input.budgetId, input.tenantId, tx);
      if (budget === null) return err(new NotFoundError("Budget not found"));

      const amount = Money.create(input.amountMinor, budget.amount.currency);
      if (!amount.ok) return err(amount.error);

      budget.revise(amount.value, this.deps.idGenerator.generate(), now);
      await this.deps.budgets.save(budget, input.tenantId, tx);
      return ok({ budgetId: budget.id.toString(), revisions: budget.revisions });
    });
  }
}

export interface RecordManualAdjustmentInput {
  readonly principal: Principal;
  readonly tenantId: string;
  readonly sourceRef: string;
  readonly debitAccountRef: string;
  readonly creditAccountRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly memo?: string;
}

/** `RecordManualAdjustment` (step-up) — posts an arbitrary balanced two-line correction journal. */
export class RecordManualAdjustment implements UseCase<
  RecordManualAdjustmentInput,
  { journalId: string }
> {
  private readonly deps: LedgerCommandDeps;
  constructor(deps: LedgerCommandDeps) {
    this.deps = deps;
  }

  async execute(
    input: RecordManualAdjustmentInput,
  ): Promise<Result<{ journalId: string }, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(
      this.deps.security,
      input.principal,
      "finance:manage",
      now,
      { action: "RecordManualAdjustment" },
      { requireStepUp: true },
    );
    if (!authz.ok) return err(authz.error);

    const amount = Money.create(input.amountMinor, input.currency);
    if (!amount.ok) return err(amount.error);

    const id = UniqueEntityId.from(this.deps.idGenerator.generate());
    const eventId = this.deps.idGenerator.generate();
    const created = Journal.create(id, input.sourceRef, input.currency, [
      JournalLine.create(input.debitAccountRef, LedgerDirection.debit(), amount.value, input.memo),
      JournalLine.create(
        input.creditAccountRef,
        LedgerDirection.credit(),
        amount.value,
        input.memo,
      ),
    ]);
    if (!created.ok) return err(created.error);

    try {
      created.value.post(eventId, now);
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }

    return this.deps.unitOfWork.run(async (tx) => {
      await this.deps.journals.append(created.value, input.tenantId, tx);
      return ok({ journalId: created.value.id.toString() });
    });
  }
}

export interface GenerateForecastInput {
  readonly principal: Principal;
  readonly figure: string;
  readonly currency: string;
  readonly horizonPeriods: number;
}

/** `GenerateForecast` — AI forecasting, **proposes-only** (`applied: false`); never changes data. */
export class GenerateForecast implements UseCase<GenerateForecastInput, ForecastProposal> {
  private readonly deps: LedgerCommandDeps;
  constructor(deps: LedgerCommandDeps) {
    this.deps = deps;
  }

  async execute(input: GenerateForecastInput): Promise<Result<ForecastProposal, DomainError>> {
    const now = this.deps.clock.now();
    const authz = await authorize(this.deps.security, input.principal, "finance:read", now, {
      action: "GenerateForecast",
    });
    if (!authz.ok) return err(authz.error);

    const proposal = await this.deps.forecast.propose(
      input.figure,
      input.currency,
      input.horizonPeriods,
    );
    return ok(proposal);
  }
}
