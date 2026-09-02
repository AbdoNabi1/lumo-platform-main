import { Balance } from "../value-objects/balance";
import type { LedgerEntry } from "../value-objects/ledger-entry";

/** Nets cash-account inflows/outflows across a set of posted ledger entries. */
export class CashFlowProjector {
  static project(
    entries: readonly LedgerEntry[],
    cashAccountRefs: readonly string[],
    currency: string,
  ): Balance {
    const cashRefs = new Set(cashAccountRefs);
    let net = Balance.zero(currency);
    for (const entry of entries) {
      if (!cashRefs.has(entry.accountRef)) continue;
      const signed = entry.direction.isDebit
        ? Balance.of(entry.amount.amountMinor, entry.amount.currency)
        : Balance.of(-entry.amount.amountMinor, entry.amount.currency);
      net = net.plus(signed);
    }
    return net;
  }
}
