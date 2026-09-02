import type { IncomeStatement } from "../domain/services/statement-builder";

/** Read-only projection of gross/net profit **amounts** for a period — no margin percentage. */
export interface ProfitReadModel {
  readonly period: string;
  readonly currency: string;
  readonly revenueMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
  readonly grossProfitMinor: number;
  readonly netProfitMinor: number;
}

export function projectProfit(
  statement: IncomeStatement,
  period: string,
  currency: string,
): ProfitReadModel {
  return {
    period,
    currency,
    revenueMinor: statement.revenue.amountMinor,
    cogsMinor: statement.cogs.amountMinor,
    expensesMinor: statement.expenses.amountMinor,
    grossProfitMinor: statement.revenue.amountMinor - statement.cogs.amountMinor,
    netProfitMinor: statement.netIncome.amountMinor,
  };
}
