import type { MerchantPaymentSettings } from "../domain/merchant-payment-settings";
import type { MerchantPaymentSettingsRepository } from "../domain/merchant-payment-settings-repository";

/** In-memory settings, keyed by tenant. ADR-0014: holds no tenant of its own. */
export class InMemoryMerchantPaymentSettingsRepository implements MerchantPaymentSettingsRepository {
  private readonly store = new Map<string, MerchantPaymentSettings>();

  get(tenantId: string): Promise<MerchantPaymentSettings | null> {
    return Promise.resolve(this.store.get(tenantId) ?? null);
  }

  save(settings: MerchantPaymentSettings, tenantId: string): Promise<void> {
    this.store.set(tenantId, settings);
    return Promise.resolve();
  }
}
