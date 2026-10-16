import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CartRepository } from "../domain/cart-repository";

export interface CheckOutCartInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly cartId: string;
}

export interface CheckOutCartOutput {
  readonly cartId: string;
  readonly totalAmountMinor: number;
}

export interface CheckOutCartDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Checks out a non-empty active cart, emitting `cart.checked_out` for the checkout saga. */
export class CheckOutCart implements UseCase<CheckOutCartInput, CheckOutCartOutput, DomainError> {
  private readonly deps: CheckOutCartDeps;

  constructor(deps: CheckOutCartDeps) {
    this.deps = deps;
  }

  async execute(input: CheckOutCartInput): Promise<Result<CheckOutCartOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<CheckOutCartOutput, DomainError>>(async (tx) => {
      const cart = await this.deps.carts.findById(input.cartId, input.tenantId, tx);
      if (cart === null) {
        return err(new NotFoundError("Cart not found"));
      }

      try {
        cart.checkOut(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.carts.save(cart, input.tenantId, tx);
      return ok({ cartId: cart.id.toString(), totalAmountMinor: cart.totalAmount().amountMinor });
    });
  }
}
