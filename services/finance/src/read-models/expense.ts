import type { Expense } from "../domain/expense";

export interface ExpenseReadModel {
  readonly period: string;
  readonly currency: string;
  readonly byCategoryMinor: Readonly<Record<string, number>>;
  readonly totalMinor: number;
}

export function projectExpense(
  expenses: readonly Expense[],
  period: string,
  currency: string,
): ExpenseReadModel {
  const byCategoryMinor: Record<string, number> = {};
  let totalMinor = 0;
  for (const expense of expenses) {
    byCategoryMinor[expense.categoryRef] =
      (byCategoryMinor[expense.categoryRef] ?? 0) + expense.amount.amountMinor;
    totalMinor += expense.amount.amountMinor;
  }
  return { period, currency, byCategoryMinor, totalMinor };
}
