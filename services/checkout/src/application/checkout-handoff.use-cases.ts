import type { UseCase } from "@platform/application";
import { isDomainError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { OrderDraft, PaymentIntentRequest } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";

export interface CheckoutSessionIdInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
}

export interface HandoffDeps {
  readonly sessions: CheckoutSessionRepository;
}

/** Assembles the pure order-draft snapshot handed to Orders — Checkout never creates the order itself. */
export class GenerateOrderDraft implements UseCase<
  CheckoutSessionIdInput,
  OrderDraft,
  DomainError
> {
  private readonly deps: HandoffDeps;

  constructor(deps: HandoffDeps) {
    this.deps = deps;
  }

  async execute(input: CheckoutSessionIdInput): Promise<Result<OrderDraft, DomainError>> {
    const session = await this.deps.sessions.findById(input.checkoutSessionId, input.tenantId);
    if (session === null) {
      return err(new NotFoundError("Checkout session not found"));
    }
    try {
      return ok(session.generateOrderDraft());
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }
  }
}

/** Assembles the pure payment-intent-request snapshot handed to Payments — Checkout never captures payment itself. */
export class GeneratePaymentIntentRequest implements UseCase<
  CheckoutSessionIdInput,
  PaymentIntentRequest,
  DomainError
> {
  private readonly deps: HandoffDeps;

  constructor(deps: HandoffDeps) {
    this.deps = deps;
  }

  async execute(input: CheckoutSessionIdInput): Promise<Result<PaymentIntentRequest, DomainError>> {
    const session = await this.deps.sessions.findById(input.checkoutSessionId, input.tenantId);
    if (session === null) {
      return err(new NotFoundError("Checkout session not found"));
    }
    try {
      return ok(session.generatePaymentIntentRequest());
    } catch (error) {
      if (isDomainError(error)) return err(error);
      throw error;
    }
  }
}
