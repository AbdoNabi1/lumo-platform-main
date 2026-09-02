import type { CursorPage } from "@platform/types";
import type { GetFolder } from "../application/get-folder.use-case";
import type { GetMediaAsset } from "../application/get-media-asset.use-case";
import type { ListFolders } from "../application/list-folders.use-case";
import type { ListMediaAssets } from "../application/list-media-assets.use-case";
import type {
  ArchiveFolder,
  ArchiveMediaAsset,
  CreateFolder,
  CreateFolderInput,
  FolderIdInput,
  GetDownloadUrl,
  GetDownloadUrlInput,
  MediaAssetIdInput,
  RegisterMediaAsset,
  RegisterMediaAssetInput,
} from "../application/media-library.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface MediaLibraryControllerDeps {
  readonly createFolder: CreateFolder;
  readonly archiveFolder: ArchiveFolder;
  readonly registerMediaAsset: RegisterMediaAsset;
  readonly archiveMediaAsset: ArchiveMediaAsset;
  readonly getDownloadUrl: GetDownloadUrl;
  readonly listFolders: ListFolders;
  readonly getFolder: GetFolder;
  readonly listMediaAssets: ListMediaAssets;
  readonly getMediaAsset: GetMediaAsset;
}

/** Framework-agnostic interface boundary for media-library use-cases (no HTTP server). */
export class MediaLibraryController {
  private readonly deps: MediaLibraryControllerDeps;

  constructor(deps: MediaLibraryControllerDeps) {
    this.deps = deps;
  }

  async createFolder(input: CreateFolderInput): Promise<ControllerResponse> {
    return present(await this.deps.createFolder.execute(input), 201);
  }

  async archiveFolder(input: FolderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.archiveFolder.execute(input), 200);
  }

  async registerMediaAsset(input: RegisterMediaAssetInput): Promise<ControllerResponse> {
    return present(await this.deps.registerMediaAsset.execute(input), 201);
  }

  async archiveMediaAsset(input: MediaAssetIdInput): Promise<ControllerResponse> {
    return present(await this.deps.archiveMediaAsset.execute(input), 200);
  }

  async getDownloadUrl(input: GetDownloadUrlInput): Promise<ControllerResponse> {
    return present(await this.deps.getDownloadUrl.execute(input), 200);
  }

  async listFolders(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listFolders.execute(input), 200);
  }

  async getFolder(input: FolderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getFolder.execute(input), 200);
  }

  async listMediaAssets(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listMediaAssets.execute(input), 200);
  }

  async getMediaAsset(input: MediaAssetIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getMediaAsset.execute(input), 200);
  }
}
