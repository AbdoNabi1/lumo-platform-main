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
    /**
     * The platform tenant scope the invoice was read under (ADR-0014). Additive and optional like
     * `idempotencyKey`: an adapter that keeps its own platform-scoped state (the stored payment
     * method) needs it, and every other implementer ignores it.
     */
    scopeTenantId?: string,
  ): Promise<{ reference: string }>;
}

/**
 * Seals and opens the merchant's card token (an envelope, bound to the payer so a blob copied to
 * another merchant's row does not open). Licensing depends on this port, never on a vault package.
 */
export interface BillingTokenSealer {
  readonly backing: "real" | "stub";
  seal(tenantRef: string, token: string): Promise<string>;
  open(tenantRef: string, sealed: string): Promise<string>;
}

/** A card-token callback whose signature was verified; only SIGNED values. `token` is a secret. */
export interface VerifiedCardToken {
  readonly tokenId: string;
  readonly token: string;
  /** The PSP order id the token was issued for — correlates it to a pending enrolment. */
  readonly providerOrderId: string;
  readonly maskedPan: string;
  readonly cardSubtype: string;
}

/**
 * Verifies the PSP's card-token callback against MORBEH'S billing account's secret and yields its
 * signed fields, or `null` when the signature or shape is wrong. The one place the signing scheme lives.
 */
export interface CardTokenCallbackVerifier {
  verify(rawBody: Uint8Array, signature: string): VerifiedCardToken | null;
}

/**
 * Starts the merchant's interactive first payment on Morbeh's own PSP account (a normal 3DS
 * checkout, which is what makes the PSP issue a token at all). Returns where to send the merchant
 * and the PSP's order id, under which the token callback will arrive.
 */
export interface CardEnrolmentPort {
  startCheckout(request: {
    readonly tenantRef: string;
    readonly amountMinor: number;
    readonly currency: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly providerOrderId: string; readonly checkoutUrl: string }>;
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

/**
 * A billing TRANSACTION callback whose signature was verified; only SIGNED values reach here
 * (`order.id`, never the unsigned `special_reference` a caller could rewrite — G-74 (8)).
 */
export interface VerifiedInvoiceTransaction {
  /** Paymob's transaction id — recorded as the invoice's `paymentReference` once settled. */
  readonly transactionId: string;
  /** Paymob's order id (SIGNED) — how this correlates to a `BillingPaymentMethod`, never the invoice directly. */
  readonly providerOrderId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly success: boolean;
  readonly pending: boolean;
  readonly isAuth: boolean;
  readonly isCapture: boolean;
  readonly isVoided: boolean;
  readonly isRefunded: boolean;
  readonly errorOccured: boolean;
}

/**
 * Verifies Morbeh's billing TRANSACTION callback — the PSP's confirmation of the merchant's
 * interactive first invoice payment (G-74 (8)) — against MORBEH'S OWN billing-account secret, by
 * the transaction-callback scheme (20 fixed fields, `packages/psp-paymob/src/webhook-signature.ts`).
 * A DIFFERENT scheme from {@link CardTokenCallbackVerifier} (D-065): Paymob signs the transaction
 * callback and the card-token callback with two different field sets under the same secret.
 */
export interface BillingTransactionCallbackVerifier {
  verify(rawBody: Uint8Array, signature: string): VerifiedInvoiceTransaction | null;
}
