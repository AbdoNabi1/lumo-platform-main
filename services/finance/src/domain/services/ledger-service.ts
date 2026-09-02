import type { AccountType } from "../value-objects/account-type";
import { Balance } from "../value-objects/balance";
import type { LedgerEntry } from "../value-objects/ledger-entry";

export interface TrialBalanceRow {
  readonly accountRef: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
}

/** Reads the immutable ledger: signed account balances and the trial balance. */
export class LedgerService {
  /** The signed balance of one account, on its own normal side (positive = normal). */
  static accountBalance(
    entries: readonly LedgerEntry[],
    accountRef: string,
    type: AccountType,
    currency: string,
  ): Balance {
    const own = entries.filter((entry) => entry.accountRef === accountRef);
    let balance = Balance.zero(currency);
    for (const entry of own) {
      const signed =
        entry.direction.value === type.normalSide
          ? Balance.of(entry.amount.amountMinor, entry.amount.currency)
          : Balance.of(-entry.amount.amountMinor, entry.amount.currency);
      balance = balance.plus(signed);
    }
    return balance;
  }

  /** Debit/credit totals per account, across all posted entries — must balance (debits = credits). */
  static trialBalance(entries: readonly LedgerEntry[]): readonly TrialBalanceRow[] {
    const rows = new Map<string, { debitMinor: number; creditMinor: number }>();
    for (const entry of entries) {
      const row = rows.get(entry.accountRef) ?? { debitMinor: 0, creditMinor: 0 };
      if (entry.direction.isDebit) {
        row.debitMinor += entry.amount.amountMinor;
      } else {
        row.creditMinor += entry.amount.amountMinor;
      }
      rows.set(entry.accountRef, row);
    }
    return [...rows.entries()].map(([accountRef, totals]) => ({ accountRef, ...totals }));
  }
}
