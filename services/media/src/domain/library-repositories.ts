import type { CursorPage, Paginated } from "@platform/types";
import type { Folder } from "./folder";
import type { MediaAsset } from "./media-asset";

/** Persistence port for {@link Folder}. */
export interface FolderRepository {
  save(folder: Folder, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Folder | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Folder>>;
}

/** Persistence port for {@link MediaAsset}. */
export interface MediaAssetRepository {
  save(asset: MediaAsset, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<MediaAsset | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<MediaAsset>>;
}
