import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CustomerRepository } from "../domain/customer-repository";
import type { CustomerLanguage } from "../domain/value-objects/customer-language";
import { validateCustomerUpdate } from "./customer-input-validation";

export interface UpdateCustomerProfileInput {
  readonly tenantId: string;
  readonly customerId: string;
  readonly name?: string;
  /** `null` clears. */
  readonly phone?: string | null;
  /** `null` clears. */
  readonly language?: CustomerLanguage | null;
}

export interface UpdateCustomerProfileOutput {
  readonly customerId: string;
}

export interface UpdateCustomerProfileDeps {
  readonly customers: CustomerRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** Changes the name, phone and/or language of a customer (only the keys present; `null` clears). */
export class UpdateCustomerProfile implements UseCase<
  UpdateCustomerProfileInput,
  UpdateCustomerProfileOutput,
  DomainError
> {
  private readonly deps: UpdateCustomerProfileDeps;

  constructor(deps: UpdateCustomerProfileDeps) {
    this.deps = deps;
  }

  async execute(
    input: UpdateCustomerProfileInput,
  ): Promise<Result<UpdateCustomerProfileOutput, DomainError>> {
    const checked = validateCustomerUpdate(input);
    if (checked.error !== null) return err(checked.error);

    return this.deps.unitOfWork.run<Result<UpdateCustomerProfileOutput, DomainError>>(
      async (tx) => {
        const customer = await this.deps.customers.findById(input.customerId, input.tenantId, tx);
        if (customer === null) return err(new NotFoundError("Customer not found"));
        customer.updateProfile(checked.value);
        await this.deps.customers.save(customer, input.tenantId, tx);
        return ok({ customerId: customer.id.toString() });
      },
    );
  }
}
