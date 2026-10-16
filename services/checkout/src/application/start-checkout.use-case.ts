import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { Guard, Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";

export interface StartCheckoutInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly cartRef: string;
  /** Omitted for a guest checkout. */
  readonly customerRef?: string;
  readonly sessionRef: string;
  readonly currency: string;
}

export interface StartCheckoutOutput {
  readonly checkoutSessionId: string;
}

export interface StartCheckoutDeps {
  readonly sessions: CheckoutSessionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
}

/** Opens a checkout session for a cart (guest or customer). */
export class StartCheckout implements UseCase<
  StartCheckoutInput,
  StartCheckoutOutput,
  DomainError
> {
  private readonly deps: StartCheckoutDeps;

  constructor(deps: StartCheckoutDeps) {
    this.deps = deps;
  }

  async execute(input: StartCheckoutInput): Promise<Result<StartCheckoutOutput, DomainError>> {
    const cartRef = Guard.againstEmpty(input.cartRef, "cartRef");
    if (!cartRef.ok) return err(cartRef.error);
    const sessionRef = Guard.againstEmpty(input.sessionRef, "sessionRef");
    if (!sessionRef.ok) return err(sessionRef.error);
    if (input.customerRef !== undefined) {
      const customerRef = Guard.againstEmpty(input.customerRef, "customerRef");
      if (!customerRef.ok) return err(customerRef.error);
    }
    // Reuse Money's currency validation (ISO-4217) without introducing a separate VO.
    const currency = Money.create(0, input.currency);
    if (!currency.ok) return err(currency.error);

    return this.deps.unitOfWork.run<Result<StartCheckoutOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const session = CheckoutSession.start(
        id,
        input.cartRef,
        input.customerRef,
        input.sessionRef,
        input.currency,
      );
      await this.deps.sessions.save(session, input.tenantId, tx);
      return ok({ checkoutSessionId: id.toString() });
    });
  }
}
