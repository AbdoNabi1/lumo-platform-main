import type { Budget } from "../domain/budget";

export interface BudgetReadModel {
  readonly costCenterRef: string;
  readonly period: string;
  readonly currency: string;
  readonly budgetedMinor: number;
  readonly actualMinor: number;
  readonly varianceMinor: number;
}

export function projectBudget(budget: Budget, actualMinor: number): BudgetReadModel {
  return {
    costCenterRef: budget.costCenterRef,
    period: budget.period,
    currency: budget.amount.currency,
    budgetedMinor: budget.amount.amountMinor,
    actualMinor,
    varianceMinor: actualMinor - budget.amount.amountMinor,
  };
}
