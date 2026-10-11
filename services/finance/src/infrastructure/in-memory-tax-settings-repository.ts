import type { TaxSettings } from "../domain/tax-settings";
import type { TaxSettingsRepository } from "../domain/tax-settings-repository";

/** ADR-0014: one settings value per tenant. */
export class InMemoryTaxSettingsRepository implements TaxSettingsRepository {
  private readonly store = new Map<string, TaxSettings>();

  get(tenantId: string): Promise<TaxSettings | null> {
    return Promise.resolve(this.store.get(tenantId) ?? null);
  }

  save(settings: TaxSettings, tenantId: string): Promise<void> {
    this.store.set(tenantId, settings);
    return Promise.resolve();
  }
}
