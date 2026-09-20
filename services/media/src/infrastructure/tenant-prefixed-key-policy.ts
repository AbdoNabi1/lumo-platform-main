import { storageKeyBelongsToTenant } from "@platform/storage";
import type { StorageKeyPolicy } from "../application/storage-key-ownership";

/**
 * Production `StorageKeyPolicy`: a key is a tenant's own iff `StorageKeyFactory` could have produced
 * it for that tenant (`@platform/storage`'s strict inverse parse, not a prefix test).
 */
export class TenantPrefixedKeyPolicy implements StorageKeyPolicy {
  belongsToTenant(storageKey: string, tenantId: string): boolean {
    return storageKeyBelongsToTenant(storageKey, tenantId);
  }
}
