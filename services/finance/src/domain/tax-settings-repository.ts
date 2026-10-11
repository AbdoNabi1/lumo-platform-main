import type { TaxSettings } from "./tax-settings";

/**
 * Persistence port for the shop's {@link TaxSettings} with its regions. ADR-0014: every method takes
 * the caller's verified `tenantId` per call. The optional `tx` scopes the call to the caller's
 * transaction (ADR-0003). Not {@link TaxProfileRepository}: that serves finance reporting.
 */
export interface TaxSettingsRepository {
  /** `null` until the merchant has saved once; callers fall back to {@link TaxSettings.defaults}. */
  get(tenantId: string, tx?: unknown): Promise<TaxSettings | null>;
  /** Replaces the shop's flags and regions (a region no longer present is removed). */
  save(settings: TaxSettings, tenantId: string, tx?: unknown): Promise<void>;
}
