import { AuthorizationError, ValidationError } from "@platform/utils";

/**
 * Outbound port: "is this object key one this tenant owns?". The rule itself lives beside the only
 * producer of keys (`@platform/storage`, `StorageKeyFactory`) and is bound in infrastructure
 * (`TenantPrefixedKeyPolicy`); the use cases take the port as a REQUIRED dependency, so a use case
 * that accepts or signs a key cannot be wired without an ownership rule (G-68 / F-22).
 */
export interface StorageKeyPolicy {
  belongsToTenant(storageKey: string, tenantId: string): boolean;
}

/**
 * What to do with an EXISTING asset row whose storage key was never minted in the tenant-prefixed
 * shape (`tenants/<tenantId>/<namespace>/<yyyy>/<mm>/<id>[.<ext>]`, `StorageKeyFactory`):
 *
 * - `"refuse"` (the default) — such a row cannot be signed. Fail closed.
 * - `"allow"` — an unprefixed legacy key may still be signed. This is an EXPLICIT, recorded allowance
 *   (G-68 in docs/architecture/23-platform-gap-register.md), passed in by the composition root only
 *   under `TENANT_MODE=single`, where there is one tenant and nothing to cross. It never covers a key
 *   that starts with `tenants/`: a key in the tenant-prefixed namespace is either this tenant's, well
 *   formed, or refused — whatever the policy says.
 *
 * It applies to SIGNING existing rows only. Registration never accepts a legacy key, so the set of
 * legacy rows can only shrink.
 */
export type LegacyStorageKeys = "refuse" | "allow";

const OWNERSHIP_MESSAGE = "storage key is not a valid key for this tenant";

/** Door 1 — registration. The same message for a foreign and a malformed key: no existence oracle. */
export function checkRegistrableKey(
  keys: StorageKeyPolicy,
  tenantId: string,
  storageKey: string,
): ValidationError | null {
  return keys.belongsToTenant(storageKey, tenantId)
    ? null
    : new ValidationError("Invalid storage key", [
        { field: "storageKey", message: OWNERSHIP_MESSAGE },
      ]);
}

/**
 * Door 2 — signing. Re-checks the key the asset ROW holds against the asset's tenant, so a row that
 * got a foreign key by any route (a pre-fix registration, a direct write) is still not a laundering
 * step to a signed URL.
 */
export function checkSignableKey(
  keys: StorageKeyPolicy,
  tenantId: string,
  storageKey: string,
  legacy: LegacyStorageKeys,
): AuthorizationError | null {
  if (keys.belongsToTenant(storageKey, tenantId)) return null;
  if (legacy === "allow" && !storageKey.startsWith("tenants/")) return null;
  return new AuthorizationError("Storage key does not belong to this tenant");
}
