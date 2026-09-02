import { BusinessRuleError } from "@platform/domain";
import type { BalanceSheet } from "../domain/services/statement-builder";

/** A fact roll-up (sign checks only) — never a recomputed metric. */
export interface FinancialHealthReadModel {
  readonly period: string;
  readonly currency: string;
  readonly assetsMinor: number;
  readonly liabilitiesMinor: number;
  readonly equityMinor: number;
  readonly netIncomeMinor: number;
  readonly solvent: boolean;
}

export function projectFinancialHealth(
  sheet: BalanceSheet,
  netIncomeMinor: number,
  period: string,
  currency: string,
): FinancialHealthReadModel {
  if (sheet.assets.amountMinor < 0) {
    throw new BusinessRuleError("Assets balance must not be negative");
  }
  return {
    period,
    currency,
    assetsMinor: sheet.assets.amountMinor,
    liabilitiesMinor: sheet.liabilities.amountMinor,
    equityMinor: sheet.equity.amountMinor,
    netIncomeMinor,
    solvent: sheet.assets.amountMinor >= sheet.liabilities.amountMinor,
  };
}
