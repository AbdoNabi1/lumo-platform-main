import type { ProviderRegistration } from "@platform/payments";
import { parsePaymobConfig, PaymobPaymentProvider } from "@platform/psp-paymob";
import type { Logger } from "@platform/utils";

/**
 * Paymob, registered with the payments registry (WP-13, open registry). This composition root owns
 * `@platform/psp-paymob`, so this is where its declarations live — `services/payments` names no
 * provider and carries no Paymob field, region list or column.
 *
 *  - capabilities: a Paymob sale settles when the customer pays (its signed callback IS the capture,
 *    so no separate capture request), it calls back, it needs each merchant's own credentials, and
 *    it can charge a saved card token with no payer present (`PaymobPaymentProvider` implements the
 *    narrow `OffSessionCharger` port — the registration TYPE requires that for this declaration, and
 *    `paymob-registration.test.ts` fails if the flag and the port drift apart). That needs the
 *    account's MOTO integration id (`config.motoIntegrationId`, optional): absent, a charge is
 *    refused before any request is sent. This registration is the MERCHANT-STORE seam; Morbeh's own
 *    billing builds the same class from its own account (`composition.ts`, `PLATFORM_BILLING_PAYMOB_*`).
 *  - config: `region` and `integrationId` are Paymob's own routing data, validated by
 *    `@platform/psp-paymob` (`parsePaymobConfig` shares `isPaymobRegion` with the adapter, so the
 *    two cannot drift).
 *  - `create` runs once per resolution with that merchant's opened credentials and is never cached:
 *    it holds nothing between calls.
 */
export function paymobRegistration(logger: Logger): ProviderRegistration {
  return {
    key: "paymob",
    capabilities: {
      settlesAtPayTime: true,
      deliversWebhooks: true,
      requiresMerchantCredentials: true,
      chargesOffSession: true,
    },
    backing: "real",
    credentialFields: ["secretKey", "hmacSecret", "publicKey"],
    parseConfig: (raw) => {
      const parsed = parsePaymobConfig(raw);
      return parsed.ok ? { ok: true, value: { ...parsed.value } } : parsed;
    },
    create: ({ config, credentials }) => {
      const parsed = parsePaymobConfig(config);
      if (!parsed.ok) {
        throw new Error(`Unsupported Paymob region or configuration: ${parsed.reason}`);
      }
      return new PaymobPaymentProvider({
        secretKey: credentials.secretKey ?? "",
        hmacSecret: credentials.hmacSecret ?? "",
        publicKey: credentials.publicKey ?? "",
        integrationId: parsed.value.integrationId,
        ...(parsed.value.motoIntegrationId === undefined
          ? {}
          : { motoIntegrationId: parsed.value.motoIntegrationId }),
        region: parsed.value.region,
        fetch: async (url, init) => fetch(url, init),
        logger,
      });
    },
  };
}
