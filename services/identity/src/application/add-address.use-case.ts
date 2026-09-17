import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import { Address } from "../domain/address";
import type { CustomerRepository } from "../domain/customer-repository";

export interface AddAddressInput {
  readonly customerId: string;
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
  readonly tenantId: string;
}

export interface AddAddressOutput {
  readonly customerId: string;
  readonly addressId: string;
}

export interface AddAddressDeps {
  readonly customers: CustomerRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
}

/** Adds a postal address to a customer. */
export class AddAddress implements UseCase<AddAddressInput, AddAddressOutput, DomainError> {
  private readonly deps: AddAddressDeps;

  constructor(deps: AddAddressDeps) {
    this.deps = deps;
  }

  async execute(input: AddAddressInput): Promise<Result<AddAddressOutput, DomainError>> {
    const addressId = UniqueEntityId.from(this.deps.idGenerator.generate());
    const address = Address.create(
      addressId,
      input.line1,
      input.city,
      input.postalCode,
      input.country,
    );
    if (!address.ok) return err(address.error);

    return this.deps.unitOfWork.run<Result<AddAddressOutput, DomainError>>(async (tx) => {
      const customer = await this.deps.customers.findById(input.customerId, input.tenantId, tx);
      if (customer === null) {
        return err(new NotFoundError("Customer not found"));
      }

      customer.addAddress(address.value);
      await this.deps.customers.save(customer, input.tenantId, tx);
      return ok({ customerId: customer.id.toString(), addressId: addressId.toString() });
    });
  }
}
