import type { Asset } from "./asset";

/** Persistence port for {@link Asset}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface AssetRepository {
  save(asset: Asset, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Asset | null>;
}
