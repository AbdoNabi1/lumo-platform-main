import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";

export interface FailCheckoutInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly reason: string;
}

export interface FailCheckoutOutput {
  readonly checkoutSessionId: string;
  readonly state: string;
}

export interface FailCheckoutDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Fails a checkout session (a saga step failed), emitting `checkout.failed`. */
export class FailCheckout implements UseCase<FailCheckoutInput, FailCheckoutOutput, DomainError> {
  private readonly deps: FailCheckoutDeps;

  constructor(deps: FailCheckoutDeps) {
    this.deps = deps;
  }

  async execute(input: FailCheckoutInput): Promise<Result<FailCheckoutOutput, DomainError>> {
    const reason = Guard.againstEmpty(input.reason, "reason");
    if (!reason.ok) return err(reason.error);

    return this.deps.unitOfWork.run<Result<FailCheckoutOutput, DomainError>>(async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) {
        return err(new NotFoundError("Checkout session not found"));
      }

      try {
        session.fail(input.reason, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: session.id.toString(), state: session.state.value });
    });
  }
}
