import { ConcurrencyError } from "@platform/utils";
import type { CheckoutSettingsValues, StoredCheckoutSettings } from "../domain/checkout-settings";
import type { CheckoutSettingsRepository } from "../domain/checkout-settings-repository";

/**
 * In-memory settings keyed by tenant, with the SAME version contract as the Prisma repository
 * (create at null, update at the version that was read, stale = `ConcurrencyError`). Holds no tenant
 * of its own (ADR-0014).
 */
export class InMemoryCheckoutSettingsRepository implements CheckoutSettingsRepository {
  private readonly store = new Map<string, StoredCheckoutSettings>();

  find(tenantId: string): Promise<StoredCheckoutSettings | null> {
    const stored = this.store.get(tenantId);
    return Promise.resolve(
      stored === undefined ? null : { values: { ...stored.values }, version: stored.version },
    );
  }

  save(
    tenantId: string,
    values: CheckoutSettingsValues,
    expectedVersion: number | null,
  ): Promise<number> {
    const current = this.store.get(tenantId)?.version ?? null;
    if (current !== expectedVersion) {
      return Promise.reject(new ConcurrencyError("Checkout settings changed since they were read"));
    }
    const version = (current ?? 0) + 1;
    this.store.set(tenantId, { values: { ...values }, version });
    return Promise.resolve(version);
  }
}
