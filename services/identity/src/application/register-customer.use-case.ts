import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError } from "@platform/utils";
import { Customer } from "../domain/customer";
import type { CustomerRepository } from "../domain/customer-repository";
import { Email } from "../domain/value-objects/email";

export interface RegisterCustomerInput {
  readonly email: string;
  readonly name: string;
}

export interface RegisterCustomerOutput {
  readonly customerId: string;
}

export interface RegisterCustomerDeps {
  readonly customers: CustomerRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Registers a new customer (email is the natural key — must be unique). */
export class RegisterCustomer implements UseCase<
  RegisterCustomerInput,
  RegisterCustomerOutput,
  DomainError
> {
  private readonly deps: RegisterCustomerDeps;

  constructor(deps: RegisterCustomerDeps) {
    this.deps = deps;
  }

  async execute(
    input: RegisterCustomerInput,
  ): Promise<Result<RegisterCustomerOutput, DomainError>> {
    const email = Email.create(input.email);
    if (!email.ok) return err(email.error);
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<RegisterCustomerOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.customers.findByEmail(email.value.value, tx);
      if (existing !== null) {
        return err(new ConflictError("A customer with this email already exists"));
      }

      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const customer = Customer.register(
        id,
        email.value,
        input.name,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.customers.save(customer, tx);
      return ok({ customerId: id.toString() });
    });
  }
}
