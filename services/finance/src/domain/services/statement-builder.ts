import { BusinessRuleError } from "@platform/domain";
import type { Account } from "../account";
import { Balance } from "../value-objects/balance";
import type { LedgerEntry } from "../value-objects/ledger-entry";
import { LedgerService, type TrialBalanceRow } from "./ledger-service";

export interface IncomeStatement {
  readonly revenue: Balance;
  readonly cogs: Balance;
  readonly expenses: Balance;
  readonly netIncome: Balance;
}

export interface BalanceSheet {
  readonly assets: Balance;
  readonly liabilities: Balance;
  readonly equity: Balance;
}

/** Builds the trial balance, income statement, and balance sheet from posted ledger entries. */
export class StatementBuilder {
  static trialBalance(entries: readonly LedgerEntry[]): readonly TrialBalanceRow[] {
    return LedgerService.trialBalance(entries);
  }

  static incomeStatement(
    entries: readonly LedgerEntry[],
    accounts: readonly Account[],
    currency: string,
  ): IncomeStatement {
    const sumByType = (type: "revenue" | "expense", subset?: readonly Account[]) =>
      (subset ?? accounts)
        .filter((account) => account.type.value === type)
        .reduce(
          (sum, account) =>
            sum.plus(LedgerService.accountBalance(entries, account.code, account.type, currency)),
          Balance.zero(currency),
        );

    const revenue = sumByType("revenue");
    // COGS accounts are a subset of expense-type accounts, coded distinctly (e.g. "5000-COGS").
    // `expenses` below is operating expenses ONLY — COGS is excluded so `netIncome` never
    // double-subtracts it (COGS accounts are still expense-type accounts by domain classification).
    const cogsAccounts = accounts.filter(
      (account) => account.type.value === "expense" && account.code.toUpperCase().includes("COGS"),
    );
    const cogsRefs = new Set(cogsAccounts.map((account) => account.code));
    const nonCogsExpenseAccounts = accounts.filter(
      (account) => account.type.value === "expense" && !cogsRefs.has(account.code),
    );
    const cogs = sumByType("expense", cogsAccounts);
    const expenses = sumByType("expense", nonCogsExpenseAccounts);
    const netIncome = revenue.minus(cogs).minus(expenses);
    return { revenue, cogs, expenses, netIncome };
  }

  /** Enforces `assets = liabilities + equity + net income` (fundamental accounting identity). */
  static balanceSheet(
    entries: readonly LedgerEntry[],
    accounts: readonly Account[],
    netIncome: Balance,
    currency: string,
  ): BalanceSheet {
    const sumByType = (type: "asset" | "liability" | "equity") =>
      accounts
        .filter((account) => account.type.value === type)
        .reduce(
          (sum, account) =>
            sum.plus(LedgerService.accountBalance(entries, account.code, account.type, currency)),
          Balance.zero(currency),
        );

    const assets = sumByType("asset");
    const liabilities = sumByType("liability");
    const equity = sumByType("equity");
    if (assets.amountMinor !== liabilities.plus(equity).plus(netIncome).amountMinor) {
      throw new BusinessRuleError(
        "Balance sheet does not satisfy assets = liabilities + equity + net income",
      );
    }
    return { assets, liabilities, equity };
  }
}
