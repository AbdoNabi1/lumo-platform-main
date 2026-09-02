import type { LedgerEntry } from "../domain/value-objects/ledger-entry";

/** Read-only projection of gross/refunded/net revenue for a period. Amounts only — no ratio KPI. */
export interface RevenueReadModel {
  readonly period: string;
  readonly currency: string;
  readonly grossMinor: number;
  readonly refundsMinor: number;
  readonly netMinor: number;
}

export function projectRevenue(
  entries: readonly LedgerEntry[],
  revenueAccountRefs: readonly string[],
  refundContraAccountRefs: readonly string[],
  period: string,
  currency: string,
): RevenueReadModel {
  const revenueRefs = new Set(revenueAccountRefs);
  const refundRefs = new Set(refundContraAccountRefs);
  const gross = sumCredits(entries, revenueRefs);
  const refunds = sumDebits(entries, refundRefs);
  return { period, currency, grossMinor: gross, refundsMinor: refunds, netMinor: gross - refunds };
}

function sumCredits(entries: readonly LedgerEntry[], refs: ReadonlySet<string>): number {
  return entries
    .filter((entry) => refs.has(entry.accountRef) && !entry.direction.isDebit)
    .reduce((sum, entry) => sum + entry.amount.amountMinor, 0);
}

function sumDebits(entries: readonly LedgerEntry[], refs: ReadonlySet<string>): number {
  return entries
    .filter((entry) => refs.has(entry.accountRef) && entry.direction.isDebit)
    .reduce((sum, entry) => sum + entry.amount.amountMinor, 0);
}
