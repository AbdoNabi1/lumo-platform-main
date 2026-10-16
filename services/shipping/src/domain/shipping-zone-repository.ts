import type { ShippingZone } from "./shipping-zone";

/**
 * Persistence port for {@link ShippingZone} with its rates. ADR-0014: every method takes the caller's
 * verified `tenantId` per call. The optional `tx` scopes the call to the caller's transaction (ADR-0003).
 */
export interface ShippingZoneRepository {
  /** Inserts or replaces the zone and its rates (a rate no longer on the zone is removed). */
  save(zone: ShippingZone, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<ShippingZone | null>;
  /** Every zone of the tenant, in display order (position, then creation). */
  list(tenantId: string, tx?: unknown): Promise<readonly ShippingZone[]>;
  /** Removes the zone and its rates. */
  delete(id: string, tenantId: string, tx?: unknown): Promise<void>;
}
