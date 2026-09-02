import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { WorkspaceRepository } from "../domain/repositories";
import type { Workspace } from "../domain/workspace";
import type { WorkspaceIdInput } from "./tenancy.use-cases";

export interface GetWorkspaceDeps {
  readonly workspaces: WorkspaceRepository;
}

/** Fetches a single workspace by id. */
export class GetWorkspace implements UseCase<WorkspaceIdInput, Workspace, DomainError> {
  private readonly deps: GetWorkspaceDeps;

  constructor(deps: GetWorkspaceDeps) {
    this.deps = deps;
  }

  async execute(input: WorkspaceIdInput): Promise<Result<Workspace, DomainError>> {
    const workspace = await this.deps.workspaces.findById(input.workspaceId);
    return workspace === null ? err(new NotFoundError("Workspace not found")) : ok(workspace);
  }
}
