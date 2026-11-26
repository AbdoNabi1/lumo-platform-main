import type { UseCase } from "@platform/application";
import { isDomainError, ProductRef } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CartRepository } from "../domain/cart-repository";
import { lineLimitError } from "../domain/line-limit";
import { Quantity } from "../domain/value-objects/quantity";

export interface ChangeItemQuantityInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly cartId: string;
  readonly productId: string;
  /** Plan 2A: the variant line to change; absent addresses a legacy line by `productId`. */
  readonly variantId?: string;
  readonly quantity: number;
  /** Wave 2a: the shop's add-to-cart limit, passed by the caller; the new quantity may not exceed it. Absent or null => no limit. */
  readonly maxLineQuantity?: number | null;
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
      const cart = await this.deps.carts.findById(input.cartId, input.tenantId, tx);
      if (cart === null) {
        return err(new NotFoundError("Cart not found"));
      }

      const overLimit = lineLimitError(input.maxLineQuantity, quantity.value.value);
      if (overLimit !== null) return err(overLimit);

      try {
        cart.changeItemQuantity(input.variantId ?? productRef.value.value, quantity.value);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.carts.save(cart, input.tenantId, tx);
      return ok({ cartId: cart.id.toString(), totalAmountMinor: cart.totalAmount().amountMinor });
    });
  }
}
