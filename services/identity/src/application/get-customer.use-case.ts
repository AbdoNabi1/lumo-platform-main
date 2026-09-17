import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Customer } from "../domain/customer";
import type { CustomerRepository } from "../domain/customer-repository";

export interface GetCustomerInput {
  readonly customerId: string;
  readonly tenantId: string;
}

export interface GetCustomerDeps {
  readonly customers: CustomerRepository;
}

/** Reads a single customer by id (mirrors Orders' `GetOrder` — a generic, no-report-named accessor). */
export class GetCustomer implements UseCase<GetCustomerInput, Customer, DomainError> {
  private readonly deps: GetCustomerDeps;

  constructor(deps: GetCustomerDeps) {
    this.deps = deps;
  }

  async execute(input: GetCustomerInput): Promise<Result<Customer, DomainError>> {
    const customer = await this.deps.customers.findById(input.customerId, input.tenantId);
    if (customer === null) {
      return err(new NotFoundError("Customer not found"));
    }
    return ok(customer);
  }
}
