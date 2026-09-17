import type { CursorPage, Paginated } from "@platform/types";
import type { Folder } from "./folder";
import type { MediaAsset } from "./media-asset";

/**
 * Persistence port for {@link Folder}.
 *
 * ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter,
 * matching `services/catalog`'s shape. `Folder` carries no `tenantId` of its own, so `save` takes
 * it as an explicit parameter (Option B) rather than reading it off the aggregate.
 */
export interface FolderRepository {
  save(folder: Folder, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Folder | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Folder>>;
}

/** Persistence port for {@link MediaAsset}. Same ADR-0014 shape as {@link FolderRepository}. */
export interface MediaAssetRepository {
  save(asset: MediaAsset, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<MediaAsset | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<MediaAsset>>;
}
