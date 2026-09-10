import type { CursorPage, Paginated } from "@platform/types";
import type { Folder } from "./folder";
import type { MediaAsset } from "./media-asset";

/**
 * Persistence port for {@link Folder}.
 *
 * ADR-0014 (WP-10, T10.3): `findById`/`list` take `tenantId` as an explicit per-call parameter,
 * matching `services/catalog`'s first-converted-context shape. `save` is not yet converted.
 */
export interface FolderRepository {
  save(folder: Folder, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Folder | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Folder>>;
}

/** Persistence port for {@link MediaAsset}. Same ADR-0014 shape as {@link FolderRepository}. */
export interface MediaAssetRepository {
  save(asset: MediaAsset, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<MediaAsset | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<MediaAsset>>;
}
