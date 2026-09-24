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
 *    it cannot yet charge with no payer present — tokenization is the next task, and until it lands
 *    Paymob is refused for recurring billing.
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
      chargesOffSession: false,
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
        region: parsed.value.region,
        fetch: async (url, init) => fetch(url, init),
        logger,
      });
    },
  };
}
