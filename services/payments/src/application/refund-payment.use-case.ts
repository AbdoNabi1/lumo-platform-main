import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError, Money } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";

export interface RefundPaymentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly paymentIntentId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface RefundPaymentOutput {
  readonly paymentIntentId: string;
  readonly status: string;
}

export interface RefundPaymentDeps {
  readonly intents: PaymentIntentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Issues a refund against a captured payment intent, emitting `payment.refunded`. */
export class RefundPayment implements UseCase<
  RefundPaymentInput,
  RefundPaymentOutput,
  DomainError
> {
  private readonly deps: RefundPaymentDeps;

  constructor(deps: RefundPaymentDeps) {
    this.deps = deps;
  }

  async execute(input: RefundPaymentInput): Promise<Result<RefundPaymentOutput, DomainError>> {
    const amount = Money.create(input.amountMinor, input.currency);
    if (!amount.ok) return err(amount.error);

    return this.deps.unitOfWork.run<Result<RefundPaymentOutput, DomainError>>(async (tx) => {
      const intent = await this.deps.intents.findById(input.paymentIntentId, input.tenantId, tx);
      if (intent === null) {
        return err(new NotFoundError("Payment intent not found"));
      }

      try {
        intent.refund(amount.value, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.intents.save(intent, input.tenantId, tx);
      return ok({ paymentIntentId: intent.id.toString(), status: intent.status.value });
    });
  }
}
