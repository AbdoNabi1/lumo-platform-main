import type { PaymentProvider } from "@platform/contracts";
import type { ProviderBuildContext, ProviderRegistration } from "../application/provider-registry";

/**
 * TEST DOUBLE ONLY. A registration shaped like the real Paymob one `apps/runtime` composes (same
 * key, capabilities, credential fields and config shape) but backed by whatever `create` the test
 * supplies — payments itself depends on no PSP package. The real registration, and the guarantee
 * that its region list is `@platform/psp-paymob`'s own, are pinned in `apps/runtime`.
 */
export const PAYMOB_LIKE_REGIONS = ["egy", "ksa", "uae"] as const;

export function paymobLikeRegistration(
  create: (context: ProviderBuildContext) => PaymentProvider,
): ProviderRegistration {
  return {
    key: "paymob",
    capabilities: {
      settlesAtPayTime: true,
      deliversWebhooks: true,
      requiresMerchantCredentials: true,
      chargesOffSession: false,
    },
    backing: "real",
    credentialFields: ["secretKey", "hmacSecret", "publicKey"],
    parseConfig: (raw) => {
      const { region, integrationId } = (raw ?? {}) as {
        region?: unknown;
        integrationId?: unknown;
      };
      if (!(PAYMOB_LIKE_REGIONS as readonly unknown[]).includes(region)) {
        return { ok: false, reason: "unsupported region" };
      }
      if (
        typeof integrationId !== "number" ||
        !Number.isSafeInteger(integrationId) ||
        integrationId <= 0
      ) {
        return { ok: false, reason: "integrationId must be a positive integer" };
      }
      return { ok: true, value: { region, integrationId } };
    },
    create,
  };
}
