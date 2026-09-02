import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { WorkspaceRepository } from "../domain/repositories";
import type { Workspace } from "../domain/workspace";

export interface ListWorkspacesDeps {
  readonly workspaces: WorkspaceRepository;
}

/** Cursor-paginated workspace listing. */
export class ListWorkspaces implements UseCase<CursorPage, Paginated<Workspace>, DomainError> {
  private readonly deps: ListWorkspacesDeps;

  constructor(deps: ListWorkspacesDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Workspace>, DomainError>> {
    return ok(await this.deps.workspaces.list(input));
  }
}
