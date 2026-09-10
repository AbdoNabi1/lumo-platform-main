import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Folder } from "../domain/folder";
import type { FolderRepository } from "../domain/library-repositories";
import type { FolderIdInput } from "./media-library.use-cases";

export interface GetFolderDeps {
  readonly folders: FolderRepository;
}

/** Fetches a single folder by id. */
export class GetFolder implements UseCase<FolderIdInput, Folder, DomainError> {
  private readonly deps: GetFolderDeps;

  constructor(deps: GetFolderDeps) {
    this.deps = deps;
  }

  async execute(input: FolderIdInput): Promise<Result<Folder, DomainError>> {
    const folder = await this.deps.folders.findById(input.folderId, input.tenantId);
    return folder === null ? err(new NotFoundError("Folder not found")) : ok(folder);
  }
}
