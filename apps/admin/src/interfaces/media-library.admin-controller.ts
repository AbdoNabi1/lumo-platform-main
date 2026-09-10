import type { Principal } from "@platform/contracts";
import type { MediaLibraryController } from "@platform/media";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface MediaLibraryAdminControllerDeps {
  readonly mediaLibrary: MediaLibraryController;
  readonly guard: AdminGuard;
}

/** Wires the Media Library admin screen to the Media Library extension (Sprint 5.4). Pure delegation. */
export class MediaLibraryAdminController {
  private readonly mediaLibrary: MediaLibraryController;
  private readonly guard: AdminGuard;

  constructor(deps: MediaLibraryAdminControllerDeps) {
    this.mediaLibrary = deps.mediaLibrary;
    this.guard = deps.guard;
  }

  async createFolder(
    principal: Principal,
    input: Parameters<MediaLibraryController["createFolder"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "media_library:create_folder");
    if (denied) return denied;
    return this.mediaLibrary.createFolder(input);
  }

  async archiveFolder(
    principal: Principal,
    input: Parameters<MediaLibraryController["archiveFolder"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "media_library:archive_folder");
    if (denied) return denied;
    return this.mediaLibrary.archiveFolder(input);
  }

  async registerMediaAsset(
    principal: Principal,
    input: Parameters<MediaLibraryController["registerMediaAsset"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "media_library:register_asset");
    if (denied) return denied;
    return this.mediaLibrary.registerMediaAsset(input);
  }

  async archiveMediaAsset(
    principal: Principal,
    input: Parameters<MediaLibraryController["archiveMediaAsset"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "media_library:archive_asset");
    if (denied) return denied;
    return this.mediaLibrary.archiveMediaAsset(input);
  }

  async getDownloadUrl(
    principal: Principal,
    input: Parameters<MediaLibraryController["getDownloadUrl"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "media_library:get_download_url");
    if (denied) return denied;
    return this.mediaLibrary.getDownloadUrl(input);
  }

  async listFolders(
    principal: Principal,
    input: Parameters<MediaLibraryController["listFolders"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "media_library:read");
    if (denied) return denied;
    return this.mediaLibrary.listFolders(input);
  }

  async getFolder(
    principal: Principal,
    input: Parameters<MediaLibraryController["getFolder"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "media_library:read");
    if (denied) return denied;
    return this.mediaLibrary.getFolder(input);
  }

  async listMediaAssets(
    principal: Principal,
    input: Parameters<MediaLibraryController["listMediaAssets"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "media_library:read");
    if (denied) return denied;
    return this.mediaLibrary.listMediaAssets(input);
  }

  async getMediaAsset(
    principal: Principal,
    input: Parameters<MediaLibraryController["getMediaAsset"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "media_library:read");
    if (denied) return denied;
    return this.mediaLibrary.getMediaAsset(input);
  }
}
