import type { UseCase } from "@platform/application";
import { isDomainError, ProductRef } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CartRepository } from "../domain/cart-repository";
import { Quantity } from "../domain/value-objects/quantity";

export interface ChangeItemQuantityInput {
  readonly cartId: string;
  readonly productId: string;
  readonly quantity: number;
}

export interface ChangeItemQuantityOutput {
  readonly cartId: string;
  readonly totalAmountMinor: number;
}

export interface ChangeItemQuantityDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** Sets the absolute quantity of an existing cart line. */
export class ChangeItemQuantity implements UseCase<
  ChangeItemQuantityInput,
  ChangeItemQuantityOutput,
  DomainError
> {
  private readonly deps: ChangeItemQuantityDeps;

  constructor(deps: ChangeItemQuantityDeps) {
    this.deps = deps;
  }

  async execute(
    input: ChangeItemQuantityInput,
  ): Promise<Result<ChangeItemQuantityOutput, DomainError>> {
    const productRef = ProductRef.create(input.productId);
    if (!productRef.ok) return err(productRef.error);
    const quantity = Quantity.create(input.quantity);
    if (!quantity.ok) return err(quantity.error);

    return this.deps.unitOfWork.run<Result<ChangeItemQuantityOutput, DomainError>>(async (tx) => {
      const cart = await this.deps.carts.findById(input.cartId, tx);
      if (cart === null) {
        return err(new NotFoundError("Cart not found"));
      }

      try {
        cart.changeItemQuantity(productRef.value.value, quantity.value);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.carts.save(cart, tx);
      return ok({ cartId: cart.id.toString(), totalAmountMinor: cart.totalAmount().amountMinor });
    });
  }
}
