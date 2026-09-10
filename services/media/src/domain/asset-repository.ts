import type { Asset } from "./asset";

/**
 * Persistence port for {@link Asset}. Implemented in infrastructure. The optional `tx` scopes the
 * call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): `findById` takes `tenantId` as an explicit per-call parameter, matching
 * `services/catalog`'s first-converted-context shape. `save` is not yet converted.
 */
export interface AssetRepository {
  save(asset: Asset, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Asset | null>;
}
