import type { PaymentProvider } from "@platform/contracts";
import type { PaymentProviderResolver, ProviderAvailability } from "../application/ports";

/**
 * TEST DOUBLE ONLY — never exported from the package entry and never composed by production code.
 * Serves ONE fake for every method of every tenant, which is exactly the shape ADR-0014 forbids for
 * a real provider; tests that do not care which provider is used (they exercise the lifecycle, not
 * the selection) use it so they need not build settings, vaults and factories. Tests that DO care
 * — selection, tenancy, credentials — use `TenantPaymentProviderResolver`.
 */
export function staticProviders(provider: PaymentProvider): PaymentProviderResolver {
  const availability: ProviderAvailability = {
    stripe: "stub",
    paymob: "absent",
    cod: "stub",
    credentialVault: "stub",
  };
  return {
    resolveForNewPayment: () => Promise.resolve(provider),
    resolveForExisting: () => Promise.resolve(provider),
    describe: () => availability,
  };
}
