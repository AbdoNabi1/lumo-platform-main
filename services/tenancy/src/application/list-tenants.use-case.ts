import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { TenantRepository } from "../domain/repositories";
import type { Tenant } from "../domain/tenant";

export interface ListTenantsDeps {
  readonly tenants: TenantRepository;
}

/** Cursor-paginated tenant listing. */
export class ListTenants implements UseCase<CursorPage, Paginated<Tenant>, DomainError> {
  private readonly deps: ListTenantsDeps;

  constructor(deps: ListTenantsDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Tenant>, DomainError>> {
    return ok(await this.deps.tenants.list(input));
  }
}
