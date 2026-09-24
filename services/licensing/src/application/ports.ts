/**
 * Outbound seam onto Payments (ADR-0012) — Licensing never talks to a PSP directly.
 *
 * Phase A.16 (Task 1/2): `idempotencyKey` is optional, additive (existing implementers with a
 * 3-arg `collect()` remain structurally valid — JS/TS allows calling a shorter function with extra
 * arguments, which are simply ignored). `CollectInvoice` always supplies a deterministic
 * `<invoiceId>:<version>:collect` key derived from the invoice's own durable identity + optimistic-
 * lock version (see `billing.use-cases.ts`) — the same "no second port/API to build, reuse what's
 * already durable" approach Payments' `<intentId>:capture` key used (Phase A.8).
 */
export interface PaymentsPort {
  /**
   * What stands behind `collect`: `"real"` moves money through a PSP; `"stub"` never does. Read by
   * `assertProductionLicensingBillingConfigured` so a stub that "collects" successfully is impossible
   * outside `local` (WP-14). Absent is treated as not-real.
   */
  readonly backing?: "real" | "stub";
  /** `amountMinor` is an INTEGER of `currency`'s minor units (WP-14 money unit convention). */
  collect(
    tenantRef: string,
    amountMinor: number,
    currency: string,
    idempotencyKey?: string,
  ): Promise<{ reference: string }>;
}

/** Outbound seam onto Finance's ledger (ADR-0024) — posts a settled amount, never mutates Finance directly. */
export interface FinanceLedgerPort {
  postSettlement(
    tenantRef: string,
    amountMinor: number,
    currency: string,
    reference: string,
  ): Promise<void>;
}

/** Replay-safe dedup for consuming `platform.usage.recorded` — backs `RecordUsage`'s idempotency. */
export interface ProcessedUsageRecordStore {
  hasProcessed(recordId: string): Promise<boolean>;
  markProcessed(recordId: string): Promise<void>;
}
