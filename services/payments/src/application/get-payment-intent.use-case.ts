import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { PaymentIntent } from "../domain/payment-intent";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";

export interface GetPaymentIntentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly paymentIntentId: string;
}

export interface GetPaymentIntentDeps {
  readonly intents: PaymentIntentRepository;
}

/** Reads a single payment intent by id (generic, no dedicated report names this use-case — matrix Medium confidence). */
export class GetPaymentIntent implements UseCase<
  GetPaymentIntentInput,
  PaymentIntent,
  DomainError
> {
  private readonly deps: GetPaymentIntentDeps;

  constructor(deps: GetPaymentIntentDeps) {
    this.deps = deps;
  }

  async execute(input: GetPaymentIntentInput): Promise<Result<PaymentIntent, DomainError>> {
    const intent = await this.deps.intents.findById(input.paymentIntentId, input.tenantId);
    if (intent === null) {
      return err(new NotFoundError("Payment intent not found"));
    }
    return ok(intent);
  }
}
