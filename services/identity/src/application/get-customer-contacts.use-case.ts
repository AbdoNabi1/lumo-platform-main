import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { CustomerContact, CustomerContactReader } from "../domain/customer-repository";

export interface GetCustomerContactsInput {
  readonly tenantId: string;
  readonly customerIds: readonly string[];
}

export interface GetCustomerContactsDeps {
  readonly customers: CustomerContactReader;
}

/**
 * The name and email of a set of customers of one shop, in ONE read (Plan 3D). What labels a page of
 * orders whose shipping address carries no recipient name. A customer that is not found is simply
 * not in the answer.
 */
export class GetCustomerContacts implements UseCase<
  GetCustomerContactsInput,
  readonly CustomerContact[],
  DomainError
> {
  private readonly deps: GetCustomerContactsDeps;

  constructor(deps: GetCustomerContactsDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetCustomerContactsInput,
  ): Promise<Result<readonly CustomerContact[], DomainError>> {
    const ids = [...new Set(input.customerIds)];
    if (ids.length === 0) return ok([]);
    return ok(await this.deps.customers.findContactsByIds(ids, input.tenantId));
  }
}
