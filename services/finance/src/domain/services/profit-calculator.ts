import type { Balance } from "../value-objects/balance";

/**
 * Net-revenue/gross/net profit **amounts** only — margins and other ratio KPIs remain Analytics
 * `MetricDefinition`s (D-064); this service never computes a percentage.
 */
export class ProfitCalculator {
  static grossProfit(revenue: Balance, cogs: Balance): Balance {
    return revenue.minus(cogs);
  }

  static netProfit(revenue: Balance, cogs: Balance, expenses: Balance): Balance {
    return revenue.minus(cogs).minus(expenses);
  }
}
