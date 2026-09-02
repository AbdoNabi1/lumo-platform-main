import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Folder } from "../domain/folder";
import type { FolderRepository } from "../domain/library-repositories";

export interface ListFoldersDeps {
  readonly folders: FolderRepository;
}

/** Cursor-paginated folder listing. */
export class ListFolders implements UseCase<CursorPage, Paginated<Folder>, DomainError> {
  private readonly deps: ListFoldersDeps;

  constructor(deps: ListFoldersDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Folder>, DomainError>> {
    return ok(await this.deps.folders.list(input));
  }
}
