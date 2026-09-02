import type { UseCase } from "@platform/application";
import type { Clock, Principal } from "@platform/contracts";
import { type Balance } from "../domain/value-objects/balance";
import { LedgerService, type TrialBalanceRow } from "../domain/services/ledger-service";
import {
  StatementBuilder,
  type BalanceSheet,
  type IncomeStatement,
} from "../domain/services/statement-builder";
import type { AccountRepository, LedgerEntryRepository } from "../domain/repositories";
import type { SecurityPort } from "./ports";
import { authorize } from "./authorize";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";

export interface FinanceQueryDeps {
  readonly accounts: AccountRepository;
  readonly ledgerEntries: LedgerEntryRepository;
  readonly security: SecurityPort;
  readonly clock: Clock;
}

export interface PeriodQueryInput {
  readonly principal: Principal;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly currency: string;
}

/** `TrialBalanceQuery` (`finance:read`) — debit/credit totals per account over a period. */
export class TrialBalanceQuery implements UseCase<
  PeriodQueryInput,
  { rows: readonly TrialBalanceRow[] }
> {
  private readonly deps: FinanceQueryDeps;
  constructor(deps: FinanceQueryDeps) {
    this.deps = deps;
  }

  async execute(
    input: PeriodQueryInput,
  ): Promise<Result<{ rows: readonly TrialBalanceRow[] }, DomainError>> {
    const authz = await authorize(
      this.deps.security,
      input.principal,
      "finance:read",
      this.deps.clock.now(),
      {
        action: "TrialBalanceQuery",
      },
    );
    if (!authz.ok) return err(authz.error);

    const entries = await this.deps.ledgerEntries.findByPeriod(input.startDate, input.endDate);
    return ok({ rows: LedgerService.trialBalance(entries) });
  }
}

/** `IncomeStatementQuery` (`finance:read`) — revenue/COGS/expenses/net income over a period. */
export class IncomeStatementQuery implements UseCase<PeriodQueryInput, IncomeStatement> {
  private readonly deps: FinanceQueryDeps;
  constructor(deps: FinanceQueryDeps) {
    this.deps = deps;
  }

  async execute(input: PeriodQueryInput): Promise<Result<IncomeStatement, DomainError>> {
    const authz = await authorize(
      this.deps.security,
      input.principal,
      "finance:read",
      this.deps.clock.now(),
      {
        action: "IncomeStatementQuery",
      },
    );
    if (!authz.ok) return err(authz.error);

    const entries = await this.deps.ledgerEntries.findByPeriod(input.startDate, input.endDate);
    const accountRefs = new Set(entries.map((entry) => entry.accountRef));
    const accounts = (await this.deps.accounts.list()).filter((account) =>
      accountRefs.has(account.code),
    );
    return ok(StatementBuilder.incomeStatement(entries, accounts, input.currency));
  }
}

/** `BalanceSheetQuery` (`finance:read`) — assets/liabilities/equity as of a period end, enforcing the accounting identity. */
export class BalanceSheetQuery implements UseCase<PeriodQueryInput, BalanceSheet> {
  private readonly deps: FinanceQueryDeps;
  constructor(deps: FinanceQueryDeps) {
    this.deps = deps;
  }

  async execute(input: PeriodQueryInput): Promise<Result<BalanceSheet, DomainError>> {
    const authz = await authorize(
      this.deps.security,
      input.principal,
      "finance:read",
      this.deps.clock.now(),
      {
        action: "BalanceSheetQuery",
      },
    );
    if (!authz.ok) return err(authz.error);

    const entries = await this.deps.ledgerEntries.findByPeriod(input.startDate, input.endDate);
    const accountRefs = new Set(entries.map((entry) => entry.accountRef));
    const accounts = (await this.deps.accounts.list()).filter((account) =>
      accountRefs.has(account.code),
    );
    const income = StatementBuilder.incomeStatement(entries, accounts, input.currency);
    const netIncome: Balance = income.netIncome;
    return ok(StatementBuilder.balanceSheet(entries, accounts, netIncome, input.currency));
  }
}
