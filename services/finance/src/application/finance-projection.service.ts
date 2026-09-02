import { projectFinancialHealth, projectMargin, projectProfit } from "../read-models";
import { StatementBuilder } from "../domain/services/statement-builder";
import type { AccountRepository, LedgerEntryRepository } from "../domain/repositories";
import type { ReadModelStore } from "../domain/read-model-store";

export interface FinanceProjectionDeps {
  readonly ledgerEntries: LedgerEntryRepository;
  readonly accounts: AccountRepository;
  readonly readModels: ReadModelStore;
}

export interface RebuildProjectionsInput {
  readonly period: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly currency: string;
}

/**
 * `FinanceProjectionService` (M6) — rebuilds `profit`/`margin`/`financial_health` read models
 * from the immutable ledger, reusing `StatementBuilder` (M2) and the read-model projectors (M3).
 * No duplicated calculation. Rebuild is idempotent: each run overwrites the period's row in
 * place via {@link ReadModelStore.put}, never appends.
 */
export class FinanceProjectionService {
  private readonly deps: FinanceProjectionDeps;

  constructor(deps: FinanceProjectionDeps) {
    this.deps = deps;
  }

  async rebuild(input: RebuildProjectionsInput): Promise<void> {
    const entries = await this.deps.ledgerEntries.findByPeriod(input.startDate, input.endDate);
    const accountRefs = new Set(entries.map((entry) => entry.accountRef));
    const accounts = (await this.deps.accounts.list()).filter((account) =>
      accountRefs.has(account.code),
    );

    const income = StatementBuilder.incomeStatement(entries, accounts, input.currency);
    const sheet = StatementBuilder.balanceSheet(
      entries,
      accounts,
      income.netIncome,
      input.currency,
    );

    const profit = projectProfit(income, input.period, input.currency);
    const margin = projectMargin(
      income.revenue.amountMinor,
      income.cogs.amountMinor,
      input.period,
      input.currency,
    );
    const health = projectFinancialHealth(
      sheet,
      income.netIncome.amountMinor,
      input.period,
      input.currency,
    );

    await this.deps.readModels.put("profit", input.period, profit);
    await this.deps.readModels.put("margin", input.period, margin);
    await this.deps.readModels.put("financial_health", input.period, health);
  }
}
