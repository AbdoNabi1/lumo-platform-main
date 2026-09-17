import type { UseCase } from "@platform/application";
import type { Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Customer } from "../domain/customer";
import type { CustomerListQuery, CustomerRepository } from "../domain/customer-repository";

export type ListCustomersInput = CustomerListQuery & { readonly tenantId: string };

export interface ListCustomersDeps {
  readonly customers: CustomerRepository;
}

/** Cursor-paginated customer listing, most recently registered first, with an optional name/email search filter — delegates straight to the repository (mirrors Orders' `ListOrders`). */
export class ListCustomers implements UseCase<
  ListCustomersInput,
  Paginated<Customer>,
  DomainError
> {
  private readonly deps: ListCustomersDeps;

  constructor(deps: ListCustomersDeps) {
    this.deps = deps;
  }

  async execute(input: ListCustomersInput): Promise<Result<Paginated<Customer>, DomainError>> {
    return ok(await this.deps.customers.list(input, input.tenantId));
  }
}
