/**
 * Plan 2C-3: Catalog's question to Media, answered by an adapter in `apps/admin` (Catalog never
 * imports Media). Batch-shaped so a list of product images costs one read, not one per product.
 */
export interface MediaLookupPort {
  /** The subset of `ids` that are the tenant's own, usable media assets. Others are simply absent. */
  existingIds(ids: readonly string[], tenantId: string): Promise<readonly string[]>;
}
