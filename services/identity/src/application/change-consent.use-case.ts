import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CustomerRepository } from "../domain/customer-repository";
import { ConsentScope } from "../domain/value-objects/consent-scope";

export interface ChangeConsentInput {
  readonly customerId: string;
  readonly scope: string;
  readonly granted: boolean;
  readonly tenantId: string;
}

export interface ChangeConsentOutput {
  readonly customerId: string;
  readonly scope: string;
  readonly granted: boolean;
}

export interface ChangeConsentDeps {
  readonly customers: CustomerRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Grants or revokes a customer's consent for a scope, emitting `consent.changed`. */
export class ChangeConsent implements UseCase<
  ChangeConsentInput,
  ChangeConsentOutput,
  DomainError
> {
  private readonly deps: ChangeConsentDeps;

  constructor(deps: ChangeConsentDeps) {
    this.deps = deps;
  }

  async execute(input: ChangeConsentInput): Promise<Result<ChangeConsentOutput, DomainError>> {
    const scope = ConsentScope.create(input.scope);
    if (!scope.ok) return err(scope.error);

    return this.deps.unitOfWork.run<Result<ChangeConsentOutput, DomainError>>(async (tx) => {
      const customer = await this.deps.customers.findById(input.customerId, input.tenantId, tx);
      if (customer === null) {
        return err(new NotFoundError("Customer not found"));
      }

      customer.changeConsent(
        UniqueEntityId.from(this.deps.idGenerator.generate()),
        scope.value,
        input.granted,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.customers.save(customer, input.tenantId, tx);
      return ok({
        customerId: customer.id.toString(),
        scope: scope.value.value,
        granted: input.granted,
      });
    });
  }
}
