export { wireMedia } from "./composition";
export type { MediaWiringDeps, WiredMedia } from "./composition";
export { AssetController } from "./interfaces/asset.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export { Asset } from "./domain/asset";
export type { AssetRepository } from "./domain/asset-repository";
export {
  PrismaAssetRepository,
  type PrismaAssetRepositoryDeps,
} from "./infrastructure/prisma-asset-repository";

// Media Library extension (Sprint 5.4) — additive, wireMediaLibrary is a separate composition root
// from wireMedia above; neither touches the other's persistence or outbox.
export { wireMediaLibrary } from "./media-library.composition";
export type { MediaLibraryWiringDeps, WiredMediaLibrary } from "./media-library.composition";
export { MediaLibraryController } from "./interfaces/media-library.controller";
export { Folder } from "./domain/folder";
export { MediaAsset } from "./domain/media-asset";
export type { FolderRepository, MediaAssetRepository } from "./domain/library-repositories";
export type { ObjectStoragePort } from "./application/object-storage.port";
export {
  InMemoryObjectStorage,
  StorageServiceObjectStorage,
} from "./infrastructure/object-storage-adapters";
export {
  PrismaFolderRepository,
  PrismaMediaAssetRepository,
  type PrismaLibraryRepositoriesDeps,
} from "./infrastructure/prisma-library-repositories";
export { MEDIA_LIBRARY_PUBLISHED_EVENTS } from "./infrastructure/media-library-event-translator";
