import type { PaymentProvider } from "@platform/contracts";
import type { PaymentProviderResolver } from "../application/ports";
import type { ProviderCapabilities } from "../domain/value-objects/provider-capabilities";

/** What the lifecycle tests' Stripe-shaped intents need: authorize → capture, signed webhooks, no per-merchant credentials. */
const AUTHORIZE_THEN_CAPTURE: ProviderCapabilities = {
  settlesAtPayTime: false,
  deliversWebhooks: true,
  requiresMerchantCredentials: false,
  chargesOffSession: false,
};

/**
 * TEST DOUBLE ONLY — never exported from the package entry and never composed by production code.
 * Serves ONE fake for every method of every tenant, which is exactly the shape ADR-0014 forbids for
 * a real provider; tests that do not care which provider is used (they exercise the lifecycle, not
 * the selection) use it so they need not build settings, vaults and registrations. Tests that DO
 * care — selection, tenancy, credentials — use `TenantPaymentProviderResolver`.
 */
export function staticProviders(
  provider: PaymentProvider,
  capabilities: ProviderCapabilities = AUTHORIZE_THEN_CAPTURE,
): PaymentProviderResolver {
  return {
    resolveForNewPayment: () => Promise.resolve(provider),
    resolveForExisting: () => Promise.resolve(provider),
    // A shared fake cannot honestly charge off-session; a test that needs one builds its own.
    resolveForOffSession: () =>
      Promise.reject(new Error("staticProviders cannot charge off-session")),
    capabilitiesOf: () => capabilities,
    describe: () => ({
      providers: [{ key: "static", capabilities, backing: "stub" }],
      credentialVault: "stub",
    }),
  };
}

/** Just the capability lookup, for use cases (`RecordWebhook`, …) that never resolve a provider. */
export function staticCapabilities(
  capabilities: ProviderCapabilities = AUTHORIZE_THEN_CAPTURE,
): Pick<PaymentProviderResolver, "capabilitiesOf"> {
  return { capabilitiesOf: () => capabilities };
}
