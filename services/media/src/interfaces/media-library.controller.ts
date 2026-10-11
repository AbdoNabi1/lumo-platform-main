import type { GetFolder } from "../application/get-folder.use-case";
import type { GetMediaAsset } from "../application/get-media-asset.use-case";
import type { ListFolders, ListFoldersInput } from "../application/list-folders.use-case";
import type {
  ListMediaAssets,
  ListMediaAssetsInput,
} from "../application/list-media-assets.use-case";
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
import type {
  UpdateMediaAlt,
  UpdateMediaAltInput,
  UploadProductImage,
  UploadProductImageInput,
} from "../application/upload-product-image.use-case";
import { type ControllerResponse, present } from "./presenter";

const envelope = (code: string, message: string, retryable: boolean) => ({
  code,
  message,
  retryable,
  fields: [],
});

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
  readonly uploadProductImage: UploadProductImage;
  readonly updateMediaAlt: UpdateMediaAlt;
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

  /** 201 with the image; 503 / 413 / 415 as plain, retry-aware envelopes the admin can show. */
  async uploadProductImage(input: UploadProductImageInput): Promise<ControllerResponse> {
    const outcome = await this.deps.uploadProductImage.execute(input);
    switch (outcome.kind) {
      case "ok":
        return { status: 201, body: outcome.image };
      case "unavailable":
        return {
          status: 503,
          body: envelope("UNAVAILABLE", "Image storage isn't set up yet.", true),
        };
      case "too_large":
        return {
          status: 413,
          body: envelope("PAYLOAD_TOO_LARGE", "The image is larger than 8 MB.", false),
        };
      case "unsupported":
        return {
          status: 415,
          body: envelope(
            "UNSUPPORTED_MEDIA_TYPE",
            "Only JPG, PNG, WebP and GIF images are accepted.",
            false,
          ),
        };
    }
  }

  async updateMediaAlt(input: UpdateMediaAltInput): Promise<ControllerResponse> {
    return present(await this.deps.updateMediaAlt.execute(input), 200);
  }

  async listFolders(input: ListFoldersInput): Promise<ControllerResponse> {
    return present(await this.deps.listFolders.execute(input), 200);
  }

  async getFolder(input: FolderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getFolder.execute(input), 200);
  }

  async listMediaAssets(input: ListMediaAssetsInput): Promise<ControllerResponse> {
    return present(await this.deps.listMediaAssets.execute(input), 200);
  }

  async getMediaAsset(input: MediaAssetIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getMediaAsset.execute(input), 200);
  }
}
