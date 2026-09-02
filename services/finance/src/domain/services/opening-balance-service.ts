import type { BusinessRuleError, ValidationError } from "@platform/domain";
import { Money, type UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { Journal } from "../journal";
import { JournalLine } from "../value-objects/journal-line";
import { LedgerDirection } from "../value-objects/ledger-direction";
import type { TrialBalanceRow } from "./ledger-service";

/**
 * Builds the opening-balance journal for a new fiscal period, carrying the prior period's
 * closing trial balance forward through an opening-balance-equity plug (so the new period starts
 * balanced without re-deriving history).
 */
export class OpeningBalanceService {
  static openingJournal(
    id: UniqueEntityId,
    sourceRef: string,
    closingTrialBalance: readonly TrialBalanceRow[],
    openingEquityAccountRef: string,
    currency: string,
  ): Result<Journal, ValidationError | BusinessRuleError> {
    const lines = closingTrialBalance
      .filter((row) => row.debitMinor !== row.creditMinor)
      .map((row) => {
        const net = row.debitMinor - row.creditMinor;
        const amount = Money.create(Math.abs(net), currency);
        const value = amount.ok ? amount.value : Money.zero(currency);
        return JournalLine.create(
          row.accountRef,
          net > 0 ? LedgerDirection.debit() : LedgerDirection.credit(),
          value,
          "opening balance",
        );
      });
    const plugMinor = lines.reduce(
      (sum, line) =>
        sum + (line.direction.isDebit ? -line.amount.amountMinor : line.amount.amountMinor),
      0,
    );
    const plugAmount = Money.create(Math.abs(plugMinor), currency);
    if (plugAmount.ok && plugAmount.value.amountMinor > 0) {
      lines.push(
        JournalLine.create(
          openingEquityAccountRef,
          plugMinor > 0 ? LedgerDirection.debit() : LedgerDirection.credit(),
          plugAmount.value,
          "opening balance equity plug",
        ),
      );
    }
    return Journal.create(id, sourceRef, currency, lines);
  }
}
