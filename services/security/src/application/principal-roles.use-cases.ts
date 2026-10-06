import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { SecurityDeps } from "./deps";

export interface ListPrincipalRoleKeysInput {
  readonly tenantId: string;
  readonly principalExternalId: string;
}

/**
 * Plan 1B-2: the role keys a principal holds right now, for minting a staff token. Read-only, no
 * audit record (unlike EvaluateAccess), tenant-scoped like every Security read.
 */
export class ListPrincipalRoleKeys implements UseCase<
  ListPrincipalRoleKeysInput,
  { readonly roleKeys: readonly string[] },
  DomainError
> {
  private readonly deps: SecurityDeps;

  constructor(deps: SecurityDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListPrincipalRoleKeysInput,
  ): Promise<Result<{ readonly roleKeys: readonly string[] }, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(
      input.principalExternalId,
      input.tenantId,
    );
    if (principal === null) return ok({ roleKeys: [] });
    const now = this.deps.clock.now();
    const assignments = await this.deps.assignments.listByPrincipal(
      principal.id.toString(),
      input.tenantId,
    );
    const roleKeys = [
      ...new Set(assignments.filter((a) => a.isActiveAt(now)).map((a) => a.roleKey)),
    ].sort();
    return ok({ roleKeys });
  }
}
