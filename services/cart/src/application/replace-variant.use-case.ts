import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { isDomainError, Money, ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CartRepository } from "../domain/cart-repository";
import { Quantity } from "../domain/value-objects/quantity";

export interface ReplaceVariantInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly cartId: string;
  readonly oldProductId: string;
  readonly newProductId: string;
  readonly quantity: number;
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
  readonly inventoryAvailable?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ReplaceVariantOutput {
  readonly cartId: string;
  readonly totalAmountMinor: number;
}

export interface ReplaceVariantDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
}

/** Replaces a cart line's product (e.g. a different variant selection) with a fresh quantity/price snapshot. */
export class ReplaceVariant implements UseCase<
  ReplaceVariantInput,
  ReplaceVariantOutput,
  DomainError
> {
  private readonly deps: ReplaceVariantDeps;

  constructor(deps: ReplaceVariantDeps) {
    this.deps = deps;
  }

  async execute(input: ReplaceVariantInput): Promise<Result<ReplaceVariantOutput, DomainError>> {
    const newProductRef = ProductRef.create(input.newProductId);
    if (!newProductRef.ok) return err(newProductRef.error);
    const quantity = Quantity.create(input.quantity);
    if (!quantity.ok) return err(quantity.error);
    const unitPrice = Money.create(input.unitPriceAmountMinor, input.currency);
    if (!unitPrice.ok) return err(unitPrice.error);

    return this.deps.unitOfWork.run<Result<ReplaceVariantOutput, DomainError>>(async (tx) => {
      const cart = await this.deps.carts.findById(input.cartId, input.tenantId, tx);
      if (cart === null) {
        return err(new NotFoundError("Cart not found"));
      }

      try {
        cart.replaceItemVariant(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          input.oldProductId,
          newProductRef.value,
          quantity.value,
          unitPrice.value,
          { inventoryAvailable: input.inventoryAvailable, metadata: input.metadata },
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.carts.save(cart, input.tenantId, tx);
      return ok({ cartId: cart.id.toString(), totalAmountMinor: cart.totalAmount().amountMinor });
    });
  }
}
