import type { MerchantCarrierSettings } from "./merchant-carrier-settings";

/** ADR-0014: a tenant-agnostic singleton; `tenantId` is a per-call parameter. */
export interface MerchantCarrierSettingsRepository {
  get(tenantId: string, tx?: unknown): Promise<MerchantCarrierSettings | null>;
  /**
   * Settings at version 0 are inserted (written as version 1); at version n ≥ 1, updated
   * `where { tenantId, version: n }` and bumped. Zero rows updated, or a concurrent first insert,
   * throws `ConcurrencyError` (Ruling 29, preflight F11).
   */
  save(settings: MerchantCarrierSettings, tenantId: string, tx?: unknown): Promise<void>;
}
