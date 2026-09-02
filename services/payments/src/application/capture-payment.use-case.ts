import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";
import { PspToken } from "../domain/value-objects/psp-token";

export interface CapturePaymentInput {
  readonly paymentIntentId: string;
  readonly pspToken: string;
}

export interface CapturePaymentOutput {
  readonly paymentIntentId: string;
  readonly status: string;
}

export interface CapturePaymentDeps {
  readonly intents: PaymentIntentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Captures a payment intent with a PSP token, emitting `payment.captured`. */
export class CapturePayment implements UseCase<
  CapturePaymentInput,
  CapturePaymentOutput,
  DomainError
> {
  private readonly deps: CapturePaymentDeps;

  constructor(deps: CapturePaymentDeps) {
    this.deps = deps;
  }

  async execute(input: CapturePaymentInput): Promise<Result<CapturePaymentOutput, DomainError>> {
    const token = PspToken.create(input.pspToken);
    if (!token.ok) return err(token.error);

    return this.deps.unitOfWork.run<Result<CapturePaymentOutput, DomainError>>(async (tx) => {
      const intent = await this.deps.intents.findById(input.paymentIntentId, tx);
      if (intent === null) {
        return err(new NotFoundError("Payment intent not found"));
      }

      try {
        intent.capture(token.value, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.intents.save(intent, tx);
      return ok({ paymentIntentId: intent.id.toString(), status: intent.status.value });
    });
  }
}
