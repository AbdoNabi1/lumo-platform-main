import type { MerchantPaymentSettings } from "./merchant-payment-settings";

/**
 * Persistence port for {@link MerchantPaymentSettings}. ADR-0014: `tenantId` is an explicit per-call
 * parameter — an implementation holds no tenant. `get` returns `null` when the merchant has stored
 * nothing (callers then apply `MerchantPaymentSettings.defaults()`).
 */
export interface MerchantPaymentSettingsRepository {
  get(tenantId: string, tx?: unknown): Promise<MerchantPaymentSettings | null>;
  save(settings: MerchantPaymentSettings, tenantId: string, tx?: unknown): Promise<void>;
}
