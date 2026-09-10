import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import { Folder } from "../domain/folder";
import type { FolderRepository, MediaAssetRepository } from "../domain/library-repositories";
import { MediaAsset } from "../domain/media-asset";
import type { ObjectStoragePort } from "./object-storage.port";

export interface MediaLibraryDeps {
  readonly folders: FolderRepository;
  readonly mediaAssets: MediaAssetRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface CreateFolderInput {
  readonly name: string;
  readonly parentFolderRef?: string;
}

export interface FolderIdOutput {
  readonly folderId: string;
}

/** Creates an organizational folder. */
export class CreateFolder implements UseCase<CreateFolderInput, FolderIdOutput, DomainError> {
  private readonly deps: MediaLibraryDeps;

  constructor(deps: MediaLibraryDeps) {
    this.deps = deps;
  }

  async execute(input: CreateFolderInput): Promise<Result<FolderIdOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<FolderIdOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const folder = Folder.create(
        id,
        input.name,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
        input.parentFolderRef,
      );
      await this.deps.folders.save(folder, tx);
      return ok({ folderId: id.toString() });
    });
  }
}

export interface FolderIdInput {
  readonly folderId: string;
  readonly tenantId: string;
}

/** Archives a folder. */
export class ArchiveFolder implements UseCase<FolderIdInput, FolderIdOutput, DomainError> {
  private readonly deps: MediaLibraryDeps;

  constructor(deps: MediaLibraryDeps) {
    this.deps = deps;
  }

  async execute(input: FolderIdInput): Promise<Result<FolderIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<FolderIdOutput, DomainError>>(async (tx) => {
      const folder = await this.deps.folders.findById(input.folderId, input.tenantId, tx);
      if (folder === null) return err(new NotFoundError("Folder not found"));

      try {
        folder.archive(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.folders.save(folder, tx);
      return ok({ folderId: folder.id.toString() });
    });
  }
}

export interface RegisterMediaAssetInput {
  readonly name: string;
  readonly storageKey: string;
  readonly folderRef?: string;
}

export interface MediaAssetIdOutput {
  readonly mediaAssetId: string;
}

export interface RegisterMediaAssetDeps extends MediaLibraryDeps {
  readonly objectStorage: ObjectStoragePort;
}

/** Registers a media asset in the library — verifies object existence via `ObjectStoragePort` first. */
export class RegisterMediaAsset implements UseCase<
  RegisterMediaAssetInput,
  MediaAssetIdOutput,
  DomainError
> {
  private readonly deps: RegisterMediaAssetDeps;

  constructor(deps: RegisterMediaAssetDeps) {
    this.deps = deps;
  }

  async execute(input: RegisterMediaAssetInput): Promise<Result<MediaAssetIdOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    const exists = await this.deps.objectStorage.exists(input.storageKey);
    if (!exists) {
      return err(
        new ValidationError("Invalid storage key", [
          { field: "storageKey", message: "object does not exist in storage" },
        ]),
      );
    }

    return this.deps.unitOfWork.run<Result<MediaAssetIdOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const asset = MediaAsset.create(
        id,
        input.name,
        input.storageKey,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
        input.folderRef,
      );
      await this.deps.mediaAssets.save(asset, tx);
      return ok({ mediaAssetId: id.toString() });
    });
  }
}

export interface MediaAssetIdInput {
  readonly mediaAssetId: string;
  readonly tenantId: string;
}

/** Archives a media asset. */
export class ArchiveMediaAsset implements UseCase<
  MediaAssetIdInput,
  MediaAssetIdOutput,
  DomainError
> {
  private readonly deps: MediaLibraryDeps;

  constructor(deps: MediaLibraryDeps) {
    this.deps = deps;
  }

  async execute(input: MediaAssetIdInput): Promise<Result<MediaAssetIdOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<MediaAssetIdOutput, DomainError>>(async (tx) => {
      const asset = await this.deps.mediaAssets.findById(input.mediaAssetId, input.tenantId, tx);
      if (asset === null) return err(new NotFoundError("Media asset not found"));

      try {
        asset.archive(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.mediaAssets.save(asset, tx);
      return ok({ mediaAssetId: asset.id.toString() });
    });
  }
}

export type GetDownloadUrlInput = MediaAssetIdInput;

export interface DownloadUrlOutput {
  readonly url: string;
}

export interface GetDownloadUrlDeps extends MediaLibraryDeps {
  readonly objectStorage: ObjectStoragePort;
}

/** Issues a download URL for a media asset through `ObjectStoragePort`. */
export class GetDownloadUrl implements UseCase<
  GetDownloadUrlInput,
  DownloadUrlOutput,
  DomainError
> {
  private readonly deps: GetDownloadUrlDeps;

  constructor(deps: GetDownloadUrlDeps) {
    this.deps = deps;
  }

  async execute(input: GetDownloadUrlInput): Promise<Result<DownloadUrlOutput, DomainError>> {
    const asset = await this.deps.mediaAssets.findById(input.mediaAssetId, input.tenantId);
    if (asset === null) return err(new NotFoundError("Media asset not found"));
    const url = await this.deps.objectStorage.getDownloadUrl(asset.storageKey);
    return ok({ url });
  }
}
