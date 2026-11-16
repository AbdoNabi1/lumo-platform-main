import { ConcurrencyError } from "@platform/utils";
import { MerchantCarrierSettings } from "../domain/merchant-carrier-settings";
import type { MerchantCarrierSettingsRepository } from "../domain/merchant-carrier-settings-repository";

/**
 * In-memory settings keyed by tenant, with the SAME version contract as the Prisma repository, so
 * use-case tests can pin Ruling 29's 409. ADR-0014: holds no tenant of its own.
 */
function copy(settings: MerchantCarrierSettings): MerchantCarrierSettings {
  return MerchantCarrierSettings.reconstitute({
    enabledCarriers: [...settings.enabledCarriers],
    carriers: structuredClone(settings.carriers),
    version: settings.version,
  });
}

export class InMemoryMerchantCarrierSettingsRepository implements MerchantCarrierSettingsRepository {
  private readonly store = new Map<string, MerchantCarrierSettings>();

  get(tenantId: string): Promise<MerchantCarrierSettings | null> {
    const stored = this.store.get(tenantId);
    return Promise.resolve(stored === undefined ? null : copy(stored));
  }

  save(settings: MerchantCarrierSettings, tenantId: string): Promise<void> {
    const current = this.store.get(tenantId)?.version ?? 0;
    if (settings.version !== current) {
      return Promise.reject(
        new ConcurrencyError("Merchant carrier settings changed since they were read"),
      );
    }
    this.store.set(
      tenantId,
      MerchantCarrierSettings.reconstitute({
        enabledCarriers: [...settings.enabledCarriers],
        carriers: structuredClone(settings.carriers),
        version: current + 1,
      }),
    );
    return Promise.resolve();
  }
}
