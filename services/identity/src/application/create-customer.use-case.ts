import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError } from "@platform/utils";
import { Customer } from "../domain/customer";
import type { CustomerAnnotationRepository } from "../domain/customer-annotations";
import type { CustomerRepository } from "../domain/customer-repository";
import { ConsentScope } from "../domain/value-objects/consent-scope";
import type { CustomerLanguage } from "../domain/value-objects/customer-language";
import { validateCreateCustomer } from "./customer-input-validation";

export interface CreateCustomerInput {
  readonly tenantId: string;
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
  readonly language?: CustomerLanguage;
  readonly note?: string;
  readonly tags?: readonly string[];
  readonly marketingEmail?: boolean;
  readonly marketingSms?: boolean;
}

export interface CreateCustomerOutput {
  readonly customerId: string;
}

export interface CreateCustomerDeps {
  readonly customers: CustomerRepository;
  readonly annotations: CustomerAnnotationRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Staff-created customer with profile, marketing assertions, note and tags — validated as a whole
 * first (ONE `ValidationError` listing every failing field), then written in ONE unit of work so a
 * failed annotation write leaves no customer, consent or outbox row.
 */
export class CreateCustomer implements UseCase<
  CreateCustomerInput,
  CreateCustomerOutput,
  DomainError
> {
  private readonly deps: CreateCustomerDeps;

  constructor(deps: CreateCustomerDeps) {
    this.deps = deps;
  }

  async execute(input: CreateCustomerInput): Promise<Result<CreateCustomerOutput, DomainError>> {
    const checked = validateCreateCustomer(input);
    if (!checked.ok) return err(checked.error);
    const fields = checked.value;

    return this.deps.unitOfWork.run<Result<CreateCustomerOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.customers.findByEmail(
        fields.email.value,
        input.tenantId,
        tx,
      );
      if (existing !== null) {
        return err(new ConflictError("A customer with this email already exists"));
      }

      const now = this.deps.clock.now();
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const customer = Customer.register(
        id,
        fields.email,
        fields.name,
        this.deps.idGenerator.generate(),
        now,
      );
      customer.updateProfile({
        ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
        ...(fields.language !== undefined ? { language: fields.language } : {}),
      });
      const channels: readonly (readonly [boolean | undefined, string])[] = [
        [input.marketingEmail, "marketing"],
        [input.marketingSms, "marketing_sms"],
      ];
      for (const [granted, scopeName] of channels) {
        if (granted !== true) continue;
        const scope = ConsentScope.create(scopeName);
        if (!scope.ok) return err(scope.error);
        customer.changeConsent(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          scope.value,
          true,
          this.deps.idGenerator.generate(),
          now,
        );
      }
      await this.deps.customers.save(customer, input.tenantId, tx);

      const customerId = id.toString();
      if (fields.note !== undefined && fields.note !== null) {
        const stored = await this.deps.annotations.setNote(
          customerId,
          fields.note,
          input.tenantId,
          tx,
        );
        if (!stored) {
          throw new Error("A just-created customer was not found while saving its note");
        }
      }
      if (fields.tags !== undefined && fields.tags.length > 0) {
        const stored = await this.deps.annotations.replaceTags(
          customerId,
          fields.tags,
          input.tenantId,
          tx,
        );
        if (stored === null) {
          throw new Error("A just-created customer was not found while saving its tags");
        }
      }
      return ok({ customerId });
    });
  }
}
