import type { OffSessionPaymentProvider, PaymentProvider } from "@platform/contracts";
import { BusinessRuleError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { PaymentProviderKey } from "../domain/value-objects/payment-provider-key";
import type { ProviderCapabilities } from "../domain/value-objects/provider-capabilities";
import type { ProviderBacking } from "./provider-registry";

export type { ProviderBacking } from "./provider-registry";

export type { PaymentIntentRequest, PaymentProvider, ProviderIntent } from "@platform/contracts";

/** Reports a payment outcome to Orders — reference-only, Payments never creates/modifies an order. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface OrdersPort {
  reportPaymentOutcome(orderRef: string, status: string, tenantId: string): Promise<void>;
}

/** Records a payment event with Finance (ADR-0024) — reference-only, Payments never posts ledger entries itself. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface FinancePort {
  recordPaymentEvent(
    orderRef: string,
    amountMinor: number,
    currency: string,
    kind: string,
    tenantId: string,
  ): Promise<void>;
}

/** Sends a best-effort lifecycle notification — reference-only, never blocks a transition's own result. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface NotificationPort {
  notify(orderRef: string, status: string, tenantId: string): Promise<void>;
}

/** Replay-safe webhook dedup — unique per `(tenant, provider, event)`, backing `RecordWebhook`'s idempotency. ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface ProcessedWebhookStore {
  hasProcessed(provider: string, eventId: string, tenantId: string): Promise<boolean>;
  markProcessed(provider: string, eventId: string, tenantId: string): Promise<void>;
}

/**
 * Why a provider could not be produced for a merchant: not enabled, not configured, or no real
 * adapter exists for it on this platform. Deliberately never answered with a stub — a merchant who
 * selects a method that nothing real backs must be refused, not silently served an in-memory PSP.
 */
export class PaymentProviderUnavailableError extends Error {
  readonly provider: string;

  constructor(provider: string, reason: string) {
    super(`Payment method "${provider}" is unavailable: ${reason}`);
    this.name = "PaymentProviderUnavailableError";
    this.provider = provider;
  }
}

/** What is registered on this platform and how each provider is backed — for the boot guard and the settings read. */
export interface ProviderAvailability {
  readonly providers: readonly {
    readonly key: PaymentProviderKey;
    readonly capabilities: ProviderCapabilities;
    readonly backing: Exclude<ProviderBacking, "absent">;
  }[];
  /** The store merchant credentials are sealed with. `stub` means it is not real encryption. */
  readonly credentialVault: ProviderBacking;
}

/**
 * Resolves the `PaymentProvider` for ONE request's tenant and the shopper's selected method
 * (ADR-0014: nothing here is captured at construction — a provider holding one merchant's API key
 * is a per-tenant object and must never be shared). `provider` is always an input, never inferred
 * (WP-13 decision 3).
 */
export interface PaymentProviderResolver {
  /** For a NEW payment: the merchant must have the method enabled. Throws {@link PaymentProviderUnavailableError}. */
  resolveForNewPayment(tenantId: string, provider: PaymentProviderKey): Promise<PaymentProvider>;
  /**
   * For an intent that already exists: enablement is NOT required — a merchant who later switches a
   * method off must still be able to refund what was taken through it. Credentials still are.
   */
  resolveForExisting(tenantId: string, provider: PaymentProviderKey): Promise<PaymentProvider>;
  /**
   * For recurring billing: a payment with no payer present. Refuses — with
   * {@link PaymentProviderUnavailableError} — any provider that does not declare
   * `chargesOffSession`, one the merchant has not enabled, and one that declares the capability but
   * builds a provider with no off-session port. As everywhere, the caller names the provider;
   * nothing here chooses one. The result is the narrow {@link OffSessionPaymentProvider}, so a caller
   * that needs an off-session charge cannot be handed one that lacks it.
   */
  resolveForOffSession(
    tenantId: string,
    provider: PaymentProviderKey,
  ): Promise<OffSessionPaymentProvider>;
  /** What a provider declares; `undefined` if nothing registered that key. Holds no tenant. */
  capabilitiesOf(provider: PaymentProviderKey): ProviderCapabilities | undefined;
  describe(): ProviderAvailability;
}

/** The one thing the aggregates' callers need from the resolver when they only branch on capabilities. */
export type ProviderCapabilityLookup = Pick<PaymentProviderResolver, "capabilitiesOf">;

/**
 * A provider's declared capabilities, or a business-rule refusal when nothing registered that key.
 * An intent whose provider is no longer registered fails CLOSED: it is neither settled nor
 * webhook-driven, because nothing can say what it is allowed to do.
 */
export function capabilitiesOrRefusal(
  lookup: ProviderCapabilityLookup,
  provider: PaymentProviderKey,
): Result<ProviderCapabilities, DomainError> {
  const capabilities = lookup.capabilitiesOf(provider);
  return capabilities === undefined
    ? err(new BusinessRuleError(`Payment method "${provider}" is not registered on this platform`))
    : ok(capabilities);
}

/**
 * Seals/opens a merchant's provider secrets (an envelope: `@platform/secrets`). What is stored is
 * only the sealed string — never plaintext in a column, a DTO or a log. Bound to `(tenantId,
 * provider)` so a sealed blob copied to another tenant's row does not open.
 */
export interface PaymentCredentialVault {
  seal(
    tenantId: string,
    provider: PaymentProviderKey,
    secrets: Readonly<Record<string, string>>,
  ): Promise<string>;
  open(
    tenantId: string,
    provider: PaymentProviderKey,
    sealed: string,
  ): Promise<Readonly<Record<string, string>>>;
  readonly backing: ProviderBacking;
}
