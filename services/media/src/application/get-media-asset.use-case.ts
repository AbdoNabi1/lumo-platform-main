import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { MediaAssetRepository } from "../domain/library-repositories";
import type { MediaAsset } from "../domain/media-asset";
import type { MediaAssetIdInput } from "./media-library.use-cases";

export interface GetMediaAssetDeps {
  readonly mediaAssets: MediaAssetRepository;
}

/** Fetches a single media asset by id. */
export class GetMediaAsset implements UseCase<MediaAssetIdInput, MediaAsset, DomainError> {
  private readonly deps: GetMediaAssetDeps;

  constructor(deps: GetMediaAssetDeps) {
    this.deps = deps;
  }

  async execute(input: MediaAssetIdInput): Promise<Result<MediaAsset, DomainError>> {
    const asset = await this.deps.mediaAssets.findById(input.mediaAssetId);
    return asset === null ? err(new NotFoundError("Media asset not found")) : ok(asset);
  }
}
