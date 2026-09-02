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
  collect(
    tenantRef: string,
    amount: number,
    currency: string,
    idempotencyKey?: string,
  ): Promise<{ reference: string }>;
}

/** Outbound seam onto Finance's ledger (ADR-0024) — posts a settled amount, never mutates Finance directly. */
export interface FinanceLedgerPort {
  postSettlement(
    tenantRef: string,
    amount: number,
    currency: string,
    reference: string,
  ): Promise<void>;
}

/** Replay-safe dedup for consuming `platform.usage.recorded` — backs `RecordUsage`'s idempotency. */
export interface ProcessedUsageRecordStore {
  hasProcessed(recordId: string): Promise<boolean>;
  markProcessed(recordId: string): Promise<void>;
}
