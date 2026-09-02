import { Balance } from "../value-objects/balance";
import type { Budget } from "../budget";

/** Actual spend minus budgeted amount for a cost center/period — positive means over budget. */
export class BudgetVarianceCalculator {
  static variance(budget: Budget, actualMinor: number): Balance {
    return Balance.of(actualMinor, budget.amount.currency).minus(
      Balance.of(budget.amount.amountMinor, budget.amount.currency),
    );
  }
}
