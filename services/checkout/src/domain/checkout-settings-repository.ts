import type { CheckoutSettingsValues, StoredCheckoutSettings } from "./checkout-settings";

/**
 * Persistence port for a shop's checkout settings (Wave 2a). One row per tenant. ADR-0014: the
 * implementation is a tenant-agnostic singleton - every call names `tenantId`.
 */
export interface CheckoutSettingsRepository {
  /** The saved settings, or null when the shop never saved any (callers then use the defaults). */
  find(tenantId: string, tx?: unknown): Promise<StoredCheckoutSettings | null>;
  /**
   * Writes `values`. `expectedVersion` is null to create the first row, else the version that was
   * read; anything else stale throws `ConcurrencyError`. Returns the new version.
   */
  save(
    tenantId: string,
    values: CheckoutSettingsValues,
    expectedVersion: number | null,
    tx?: unknown,
  ): Promise<number>;
}
