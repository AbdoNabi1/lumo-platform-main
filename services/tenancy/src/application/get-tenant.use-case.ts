import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { TenantRepository } from "../domain/repositories";
import type { Tenant } from "../domain/tenant";
import type { TenantIdInput } from "./tenancy.use-cases";

export interface GetTenantDeps {
  readonly tenants: TenantRepository;
}

/** Fetches a single tenant by id. */
export class GetTenant implements UseCase<TenantIdInput, Tenant, DomainError> {
  private readonly deps: GetTenantDeps;

  constructor(deps: GetTenantDeps) {
    this.deps = deps;
  }

  async execute(input: TenantIdInput): Promise<Result<Tenant, DomainError>> {
    const tenant = await this.deps.tenants.findById(input.tenantId);
    return tenant === null ? err(new NotFoundError("Tenant not found")) : ok(tenant);
  }
}
