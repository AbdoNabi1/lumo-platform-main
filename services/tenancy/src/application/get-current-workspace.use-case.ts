import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { WorkspaceRepository } from "../domain/repositories";
import type { Workspace } from "../domain/workspace";

export interface GetCurrentWorkspaceDeps {
  readonly workspaces: WorkspaceRepository;
}

/**
 * Resolves the current tenant's workspace — no input: "current" is the tenant this composition
 * root/request is already pinned to (`x-tenant-id`, `singleTenantGuardedResolver`), not something
 * the caller supplies. See `WorkspaceRepository.findCurrent`'s doc comment for the tie-break.
 */
export class GetCurrentWorkspace
  implements UseCase<Record<string, never>, Workspace, DomainError>
{
  private readonly deps: GetCurrentWorkspaceDeps;

  constructor(deps: GetCurrentWorkspaceDeps) {
    this.deps = deps;
  }

  async execute(_input: Record<string, never>): Promise<Result<Workspace, DomainError>> {
    const workspace = await this.deps.workspaces.findCurrent();
    return workspace === null
      ? err(new NotFoundError("No workspace exists for the current tenant"))
      : ok(workspace);
  }
}
