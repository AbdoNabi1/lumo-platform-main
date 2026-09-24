import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { Guard, Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ValidationError, type DomainError } from "@platform/utils";
import { PaymentIntent } from "../domain/payment-intent";
import { isWellFormedProviderKey } from "../domain/value-objects/payment-provider-key";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";
import type { ProviderCapabilityLookup } from "./ports";

export interface CreatePaymentIntentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** The shopper's selected method (WP-13) — required, never inferred. */
  readonly provider: string;
}

export interface CreatePaymentIntentOutput {
  readonly paymentIntentId: string;
}

export interface CreatePaymentIntentDeps {
  readonly intents: PaymentIntentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  /** A method nothing registered is refused at the boundary — the registry, not a list in the domain, says which exist. */
  readonly providers: ProviderCapabilityLookup;
}

/** Opens a payment intent for an order (referenced by bare id). */
export class CreatePaymentIntent implements UseCase<
  CreatePaymentIntentInput,
  CreatePaymentIntentOutput,
  DomainError
> {
  private readonly deps: CreatePaymentIntentDeps;

  constructor(deps: CreatePaymentIntentDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreatePaymentIntentInput,
  ): Promise<Result<CreatePaymentIntentOutput, DomainError>> {
    const orderRef = Guard.againstEmpty(input.orderRef, "orderRef");
    if (!orderRef.ok) return err(orderRef.error);
    const amount = Money.create(input.amountMinor, input.currency);
    if (!amount.ok) return err(amount.error);
    if (
      !isWellFormedProviderKey(input.provider) ||
      this.deps.providers.capabilitiesOf(input.provider) === undefined
    ) {
      return err(new ValidationError("Unknown payment method", []));
    }
    const provider = input.provider;

    return this.deps.unitOfWork.run<Result<CreatePaymentIntentOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const intent = PaymentIntent.create(id, input.orderRef, amount.value, provider);
      await this.deps.intents.save(intent, input.tenantId, tx);
      return ok({ paymentIntentId: id.toString() });
    });
  }
}
