import {
  BostaCarrierProvider,
  BostaClient,
  parseBostaConfig,
  type BostaCityDirectory,
} from "@platform/carrier-bosta";
import type { CarrierRegistration } from "@platform/shipping";

/** Where Bosta posts delivery updates, relative to the admin API's public origin (Ruling 31). */
export const BOSTA_WEBHOOK_PATH = "/api/v1/public/shipping/webhook/bosta";

/** `<origin>/api/v1/public/shipping/webhook/bosta`; a trailing "/" on the origin is trimmed. */
export function bostaWebhookUrl(adminApiPublicUrl: string): string {
  return `${adminApiPublicUrl.replace(/\/+$/, "")}${BOSTA_WEBHOOK_PATH}`;
}

/**
 * Bosta, registered with the shipping carrier registry. This composition root owns
 * `@platform/carrier-bosta`, so its declarations live here. The `CarrierRegistration` return
 * annotation IS the structural check that `BostaCarrierProvider` satisfies shipping's
 * `CarrierProvider` port (Ruling 20); never cast it away.
 *
 * `create` runs once per resolution with that merchant's opened credentials and holds nothing
 * between calls; the city directory is the one process-wide cache (keyed by country id only).
 */
export function bostaRegistration(deps: {
  readonly webhookUrl: string;
  readonly cities: BostaCityDirectory;
}): CarrierRegistration {
  return {
    key: "bosta",
    displayName: "Bosta",
    backing: "real",
    credentialFields: ["apiKey"],
    capabilities: { cod: true, awb: true, webhooks: true, cancel: true },
    webhookUrl: deps.webhookUrl,
    parseConfig: (raw) => {
      const parsed = parseBostaConfig(raw);
      return parsed.ok ? { ok: true, value: { ...parsed.value } } : parsed;
    },
    create: ({ config, credentials, webhookHeaders }) => {
      const parsed = parseBostaConfig(config);
      if (!parsed.ok) {
        throw new Error(`Unsupported Bosta configuration: ${parsed.reason}`);
      }
      return new BostaCarrierProvider({
        client: new BostaClient({
          apiKey: credentials.apiKey ?? "",
          fetch: async (url, init) => fetch(url, init),
        }),
        cities: deps.cities,
        config: parsed.value,
        webhookUrl: deps.webhookUrl,
        webhookHeaders,
      });
    },
  };
}
