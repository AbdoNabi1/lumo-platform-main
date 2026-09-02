import { UniqueEntityId } from "@platform/domain";
import { Folder } from "../domain/folder";
import { MediaAsset } from "../domain/media-asset";
import { LibraryEntryStatus, type LibraryEntryStatusValue } from "../domain/value-objects/library";

export interface FolderRow {
  readonly id: string;
  readonly name: string;
  readonly parentFolderRef: string | null;
  readonly status: string;
  readonly version: number;
}

export interface MediaAssetRow {
  readonly id: string;
  readonly name: string;
  readonly storageKey: string;
  readonly folderRef: string | null;
  readonly status: string;
  readonly version: number;
}

export class FolderMapper {
  static toDomain(row: FolderRow): Folder {
    return Folder.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      LibraryEntryStatus.from(row.status as LibraryEntryStatusValue),
      row.version,
      row.parentFolderRef ?? undefined,
    );
  }

  static toRow(folder: Folder, tenantId: string) {
    return {
      id: folder.id.toString(),
      tenantId,
      name: folder.name,
      parentFolderRef: folder.parentFolderRef ?? null,
      status: folder.status.value,
      version: 1,
    };
  }
}

export class MediaAssetMapper {
  static toDomain(row: MediaAssetRow): MediaAsset {
    return MediaAsset.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      row.storageKey,
      LibraryEntryStatus.from(row.status as LibraryEntryStatusValue),
      row.version,
      row.folderRef ?? undefined,
    );
  }

  static toRow(asset: MediaAsset, tenantId: string) {
    return {
      id: asset.id.toString(),
      tenantId,
      name: asset.name,
      storageKey: asset.storageKey,
      folderRef: asset.folderRef ?? null,
      status: asset.status.value,
      version: 1,
    };
  }
}
