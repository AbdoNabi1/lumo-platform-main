import type { UseCase } from "@platform/application";
import type { IdGenerator } from "@platform/contracts";
import { isDomainError, Money, ProductRef, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CartRepository } from "../domain/cart-repository";
import { Quantity } from "../domain/value-objects/quantity";

export interface AddItemInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly cartId: string;
  readonly productId: string;
  readonly quantity: number;
  /** Unit-price snapshot (minor units) captured by the caller, e.g. from Pricing. */
  readonly unitPriceAmountMinor: number;
  readonly currency: string;
  /** Inventory's `available` snapshot at add-time (caller-supplied, Sprint 4.5). */
  readonly inventoryAvailable?: number;
  /** Free-form caller metadata (e.g. selected variant options), stored verbatim (Sprint 4.5). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AddItemOutput {
  readonly cartId: string;
  readonly totalAmountMinor: number;
}

export interface AddItemDeps {
  readonly carts: CartRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
}

/** Adds a line to a cart (merging quantity if the product is already present). */
export class AddItem implements UseCase<AddItemInput, AddItemOutput, DomainError> {
  private readonly deps: AddItemDeps;

  constructor(deps: AddItemDeps) {
    this.deps = deps;
  }

  async execute(input: AddItemInput): Promise<Result<AddItemOutput, DomainError>> {
    const productRef = ProductRef.create(input.productId);
    if (!productRef.ok) return err(productRef.error);
    const quantity = Quantity.create(input.quantity);
    if (!quantity.ok) return err(quantity.error);
    const unitPrice = Money.create(input.unitPriceAmountMinor, input.currency);
    if (!unitPrice.ok) return err(unitPrice.error);

    return this.deps.unitOfWork.run<Result<AddItemOutput, DomainError>>(async (tx) => {
      const cart = await this.deps.carts.findById(input.cartId, input.tenantId, tx);
      if (cart === null) {
        return err(new NotFoundError("Cart not found"));
      }

      try {
        cart.addItem(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          productRef.value,
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
