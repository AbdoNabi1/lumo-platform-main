import type { UseCase } from "@platform/application";
import { isDomainError, ProductRef } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CartRepository } from "../domain/cart-repository";

export interface RemoveItemInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly cartId: string;
  readonly productId: string;
}

export interface RemoveItemOutput {
  readonly cartId: string;
  readonly totalAmountMinor: number;
}

export interface RemoveItemDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** Removes a line from a cart. */
export class RemoveItem implements UseCase<RemoveItemInput, RemoveItemOutput, DomainError> {
  private readonly deps: RemoveItemDeps;

  constructor(deps: RemoveItemDeps) {
    this.deps = deps;
  }

  async execute(input: RemoveItemInput): Promise<Result<RemoveItemOutput, DomainError>> {
    const productRef = ProductRef.create(input.productId);
    if (!productRef.ok) return err(productRef.error);

    return this.deps.unitOfWork.run<Result<RemoveItemOutput, DomainError>>(async (tx) => {
      const cart = await this.deps.carts.findById(input.cartId, input.tenantId, tx);
      if (cart === null) {
        return err(new NotFoundError("Cart not found"));
      }

      try {
        cart.removeItem(productRef.value.value);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.carts.save(cart, input.tenantId, tx);
      return ok({ cartId: cart.id.toString(), totalAmountMinor: cart.totalAmount().amountMinor });
    });
  }
}
