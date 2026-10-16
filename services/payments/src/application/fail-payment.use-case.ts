import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";

export interface FailPaymentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly paymentIntentId: string;
  readonly reason: string;
}

export interface FailPaymentOutput {
  readonly paymentIntentId: string;
  readonly status: string;
}

export interface FailPaymentDeps {
  readonly intents: PaymentIntentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Marks a payment intent failed (e.g. PSP decline), emitting `payment.failed`. */
export class FailPayment implements UseCase<FailPaymentInput, FailPaymentOutput, DomainError> {
  private readonly deps: FailPaymentDeps;

  constructor(deps: FailPaymentDeps) {
    this.deps = deps;
  }

  async execute(input: FailPaymentInput): Promise<Result<FailPaymentOutput, DomainError>> {
    const reason = Guard.againstEmpty(input.reason, "reason");
    if (!reason.ok) return err(reason.error);

    return this.deps.unitOfWork.run<Result<FailPaymentOutput, DomainError>>(async (tx) => {
      const intent = await this.deps.intents.findById(input.paymentIntentId, input.tenantId, tx);
      if (intent === null) {
        return err(new NotFoundError("Payment intent not found"));
      }

      try {
        intent.fail(input.reason, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.intents.save(intent, input.tenantId, tx);
      return ok({ paymentIntentId: intent.id.toString(), status: intent.status.value });
    });
  }
}
