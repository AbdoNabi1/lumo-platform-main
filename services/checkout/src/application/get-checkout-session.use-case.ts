import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";

export interface GetCheckoutSessionInput {
  readonly checkoutSessionId: string;
}

export interface GetCheckoutSessionDeps {
  readonly sessions: CheckoutSessionRepository;
}

/** Fetches a single checkout session by id. */
export class GetCheckoutSession
  implements UseCase<GetCheckoutSessionInput, CheckoutSession, DomainError>
{
  private readonly deps: GetCheckoutSessionDeps;

  constructor(deps: GetCheckoutSessionDeps) {
    this.deps = deps;
  }

  async execute(input: GetCheckoutSessionInput): Promise<Result<CheckoutSession, DomainError>> {
    const session = await this.deps.sessions.findById(input.checkoutSessionId);
    return session === null ? err(new NotFoundError("Checkout session not found")) : ok(session);
  }
}
