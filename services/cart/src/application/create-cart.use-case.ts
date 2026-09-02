import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { Guard, Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { Cart } from "../domain/cart";
import type { CartRepository } from "../domain/cart-repository";

export interface CreateCartInput {
  /** Omitted for a guest cart (Sprint 4.5). */
  readonly customerRef?: string;
  readonly sessionRef: string;
  readonly currency: string;
}

export interface CreateCartOutput {
  readonly cartId: string;
}

export interface CreateCartDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
}

/** Opens a new, empty active cart for a customer (or, if `customerRef` is omitted, a guest session). */
export class CreateCart implements UseCase<CreateCartInput, CreateCartOutput, DomainError> {
  private readonly deps: CreateCartDeps;

  constructor(deps: CreateCartDeps) {
    this.deps = deps;
  }

  async execute(input: CreateCartInput): Promise<Result<CreateCartOutput, DomainError>> {
    const sessionRef = Guard.againstEmpty(input.sessionRef, "sessionRef");
    if (!sessionRef.ok) return err(sessionRef.error);
    if (input.customerRef !== undefined) {
      const customerRef = Guard.againstEmpty(input.customerRef, "customerRef");
      if (!customerRef.ok) return err(customerRef.error);
    }
    // Reuse Money's currency validation (ISO-4217) without introducing a separate VO.
    const currency = Money.create(0, input.currency);
    if (!currency.ok) return err(currency.error);

    return this.deps.unitOfWork.run<Result<CreateCartOutput, DomainError>>(async (tx) => {
      const cart = Cart.create(
        UniqueEntityId.from(this.deps.idGenerator.generate()),
        input.customerRef,
        input.sessionRef,
        input.currency,
      );
      await this.deps.carts.save(cart, tx);
      return ok({ cartId: cart.id.toString() });
    });
  }
}
