import type { ShippingZone } from "../domain/shipping-zone";
import type { ShippingZoneRepository } from "../domain/shipping-zone-repository";

/** ADR-0014: keyed by `(tenantId, zoneId)`; insertion order is the tie-break for display order. */
export class InMemoryShippingZoneRepository implements ShippingZoneRepository {
  private readonly store = new Map<string, Map<string, ShippingZone>>();

  private bucket(tenantId: string): Map<string, ShippingZone> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    return bucket;
  }

  save(zone: ShippingZone, tenantId: string): Promise<void> {
    this.bucket(tenantId).set(zone.id.toString(), zone);
    return Promise.resolve();
  }

  findById(id: string, tenantId: string): Promise<ShippingZone | null> {
    return Promise.resolve(this.bucket(tenantId).get(id) ?? null);
  }

  list(tenantId: string): Promise<readonly ShippingZone[]> {
    return Promise.resolve(
      [...this.bucket(tenantId).values()].sort((a, b) => a.position - b.position),
    );
  }

  delete(id: string, tenantId: string): Promise<void> {
    this.bucket(tenantId).delete(id);
    return Promise.resolve();
  }
}
