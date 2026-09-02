import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { MediaAssetRepository } from "../domain/library-repositories";
import type { MediaAsset } from "../domain/media-asset";

export interface ListMediaAssetsDeps {
  readonly mediaAssets: MediaAssetRepository;
}

/** Cursor-paginated media-asset listing. */
export class ListMediaAssets implements UseCase<CursorPage, Paginated<MediaAsset>, DomainError> {
  private readonly deps: ListMediaAssetsDeps;

  constructor(deps: ListMediaAssetsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<MediaAsset>, DomainError>> {
    return ok(await this.deps.mediaAssets.list(input));
  }
}
