import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CartRepository } from "../domain/cart-repository";

export interface AbandonCartInput {
  readonly cartId: string;
}

export interface AbandonCartOutput {
  readonly cartId: string;
}

export interface AbandonCartDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Marks an active cart as abandoned, emitting `cart.abandoned`. */
export class AbandonCart implements UseCase<AbandonCartInput, AbandonCartOutput, DomainError> {
  private readonly deps: AbandonCartDeps;

  constructor(deps: AbandonCartDeps) {
    this.deps = deps;
  }

  async execute(input: AbandonCartInput): Promise<Result<AbandonCartOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<AbandonCartOutput, DomainError>>(async (tx) => {
      const cart = await this.deps.carts.findById(input.cartId, tx);
      if (cart === null) {
        return err(new NotFoundError("Cart not found"));
      }

      try {
        cart.abandon(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.carts.save(cart, tx);
      return ok({ cartId: cart.id.toString() });
    });
  }
}
