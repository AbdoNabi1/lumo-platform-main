import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, NotFoundError } from "@platform/utils";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import type { OrderCreationPort } from "./ports";

export interface CompleteCheckoutInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly idempotencyKey: string;
}

export interface CompleteCheckoutOutput {
  readonly checkoutSessionId: string;
  readonly state: string;
  readonly orderRef: string;
}

export interface CompleteCheckoutDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly orderCreation: OrderCreationPort;
}

/**
 * Completes a checkout session by materializing the order via `OrderCreationPort` (C-2), emitting
 * `checkout.completed`. Idempotent per `idempotencyKey`: if the session was already completed by a
 * prior call (`session.orderRef !== null`), short-circuits and returns the recorded `orderRef`
 * without regenerating the order draft or calling the port again — Orders has no
 * `findByIdempotencyKey`, so this is done via session state rather than a repository lookup.
 */
export class CompleteCheckout implements UseCase<
  CompleteCheckoutInput,
  CompleteCheckoutOutput,
  DomainError
> {
  private readonly deps: CompleteCheckoutDeps;

  constructor(deps: CompleteCheckoutDeps) {
    this.deps = deps;
  }

  async execute(
    input: CompleteCheckoutInput,
  ): Promise<Result<CompleteCheckoutOutput, DomainError>> {
    const idempotencyKey = Guard.againstEmpty(input.idempotencyKey, "idempotencyKey");
    if (!idempotencyKey.ok) return err(idempotencyKey.error);

    return this.deps.unitOfWork.run<Result<CompleteCheckoutOutput, DomainError>>(async (tx) => {
      const session = await this.deps.sessions.findById(
        input.checkoutSessionId,
        input.tenantId,
        tx,
      );
      if (session === null) {
        return err(new NotFoundError("Checkout session not found"));
      }

      if (session.orderRef !== null) {
        return ok({
          checkoutSessionId: session.id.toString(),
          state: session.state.value,
          orderRef: session.orderRef,
        });
      }

      // C-2 fix-round-1: a failed/expired session still carries its items/addresses/totals from
      // before the transition (fail()/expire() don't clear them), so generateOrderDraft() below
      // would succeed and the real orderCreation.create() call would fire — creating a live,
      // orphaned order — before session.complete()'s own ensureOpen() ever gets a chance to reject
      // it. Reject here, before any side-effecting call, using the same "not open" rule
      // CheckoutSession's private ensureOpen() enforces (checkout-session.ts).
      if (!session.state.isOpen) {
        return err(
          new BusinessRuleError(
            `Checkout session is ${session.state.value} and can no longer be modified`,
          ),
        );
      }

      let draft;
      try {
        draft = session.generateOrderDraft();
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      const { orderRef } = await this.deps.orderCreation.create({
        tenantId: input.tenantId,
        checkoutSessionId: session.id.toString(),
        customerRef: draft.customerRef,
        contactEmail: draft.contactEmail,
        currency: session.currency,
        items: draft.items,
        billingAddress: draft.billingAddress,
        shippingAddress: draft.shippingAddress,
        totals: draft.totals,
        idempotencyKey: input.idempotencyKey,
      });

      try {
        session.complete(orderRef, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: session.id.toString(), state: session.state.value, orderRef });
    });
  }
}
