import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { CustomerRepository } from "../domain/customer-repository";
import { ConsentScope } from "../domain/value-objects/consent-scope";

/** What the consent record says about where the choice came from. */
export const SHOPPER_CHECKOUT_CONSENT_SOURCE = "shopper/checkout";

export interface RecordShopperMarketingConsentInput {
  readonly tenantId: string;
  readonly customerId: string;
  /** Only a grant is ever recorded here: an unticked box writes nothing. */
  readonly granted: true;
  readonly source: "checkout";
  /** The checkout the shopper ticked the box in (for the audit trail in logs; never PII). */
  readonly checkoutId: string;
}

export interface RecordShopperMarketingConsentOutput {
  readonly customerId: string;
  /** False when the customer had already agreed, so nothing new was written. */
  readonly recorded: boolean;
}

export interface RecordShopperMarketingConsentDeps {
  readonly customers: CustomerRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Records that the SHOPPER agreed to marketing email by ticking the box at checkout. Separate from the
 * staff `ChangeMarketingConsent` (a merchant's assertion): the record carries `source = shopper/checkout`
 * and the event says so. Scope is `marketing` (email). Idempotent: a customer who already agreed gets no
 * second record. It never revokes - unticking a box at checkout is not an opt-out.
 */
export class RecordShopperMarketingConsent implements UseCase<
  RecordShopperMarketingConsentInput,
  RecordShopperMarketingConsentOutput,
  DomainError
> {
  private readonly deps: RecordShopperMarketingConsentDeps;

  constructor(deps: RecordShopperMarketingConsentDeps) {
    this.deps = deps;
  }

  async execute(
    input: RecordShopperMarketingConsentInput,
  ): Promise<Result<RecordShopperMarketingConsentOutput, DomainError>> {
    const issues: { field: string; message: string }[] = [];
    if (input.granted !== true) issues.push({ field: "granted", message: "must be true" });
    if (input.source !== "checkout") issues.push({ field: "source", message: "must be checkout" });
    if (typeof input.checkoutId !== "string" || input.checkoutId.length === 0) {
      issues.push({ field: "checkoutId", message: "is required" });
    }
    if (issues.length > 0) {
      return err(new ValidationError("Invalid shopper marketing consent", issues));
    }
    const scope = ConsentScope.create("marketing");
    if (!scope.ok) return err(scope.error);

    return this.deps.unitOfWork.run<Result<RecordShopperMarketingConsentOutput, DomainError>>(
      async (tx) => {
        const customer = await this.deps.customers.findById(input.customerId, input.tenantId, tx);
        if (customer === null) return err(new NotFoundError("Customer not found"));
        if (customer.consentFor(scope.value)) {
          return ok({ customerId: customer.id.toString(), recorded: false });
        }
        customer.changeConsent(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          scope.value,
          true,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
          SHOPPER_CHECKOUT_CONSENT_SOURCE,
        );
        await this.deps.customers.save(customer, input.tenantId, tx);
        return ok({ customerId: customer.id.toString(), recorded: true });
      },
    );
  }
}
