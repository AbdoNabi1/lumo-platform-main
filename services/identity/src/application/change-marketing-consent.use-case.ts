import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { CustomerRepository } from "../domain/customer-repository";
import { ConsentScope } from "../domain/value-objects/consent-scope";

export interface ChangeMarketingConsentInput {
  readonly tenantId: string;
  readonly customerId: string;
  readonly email?: boolean;
  readonly sms?: boolean;
}

export interface ChangeMarketingConsentOutput {
  readonly customerId: string;
  readonly email: boolean;
  readonly sms: boolean;
}

export interface ChangeMarketingConsentDeps {
  readonly customers: CustomerRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Records a staff assertion of the customer's email / SMS marketing choice (not proof the shopper
 * opted in). Only a channel whose value actually differs appends a consent record (and emits
 * `consent.changed`); one save.
 */
export class ChangeMarketingConsent implements UseCase<
  ChangeMarketingConsentInput,
  ChangeMarketingConsentOutput,
  DomainError
> {
  private readonly deps: ChangeMarketingConsentDeps;

  constructor(deps: ChangeMarketingConsentDeps) {
    this.deps = deps;
  }

  async execute(
    input: ChangeMarketingConsentInput,
  ): Promise<Result<ChangeMarketingConsentOutput, DomainError>> {
    const issues: { field: string; message: string }[] = [];
    if (input.email === undefined && input.sms === undefined) {
      issues.push({ field: "body", message: "provide at least one field" });
    }
    if (input.email !== undefined && typeof input.email !== "boolean") {
      issues.push({ field: "email", message: "must be true or false" });
    }
    if (input.sms !== undefined && typeof input.sms !== "boolean") {
      issues.push({ field: "sms", message: "must be true or false" });
    }
    if (issues.length > 0) return err(new ValidationError("Invalid marketing consent", issues));
    const emailScope = ConsentScope.create("marketing");
    const smsScope = ConsentScope.create("marketing_sms");
    if (!emailScope.ok) return err(emailScope.error);
    if (!smsScope.ok) return err(smsScope.error);

    return this.deps.unitOfWork.run<Result<ChangeMarketingConsentOutput, DomainError>>(
      async (tx) => {
        const customer = await this.deps.customers.findById(input.customerId, input.tenantId, tx);
        if (customer === null) return err(new NotFoundError("Customer not found"));

        let changed = false;
        const requested: readonly (readonly [boolean | undefined, ConsentScope])[] = [
          [input.email, emailScope.value],
          [input.sms, smsScope.value],
        ];
        for (const [granted, scope] of requested) {
          if (granted === undefined || customer.consentFor(scope) === granted) continue;
          customer.changeConsent(
            UniqueEntityId.from(this.deps.idGenerator.generate()),
            scope,
            granted,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
          changed = true;
        }
        if (changed) await this.deps.customers.save(customer, input.tenantId, tx);
        return ok({
          customerId: customer.id.toString(),
          email: customer.consentFor(emailScope.value),
          sms: customer.consentFor(smsScope.value),
        });
      },
    );
  }
}
