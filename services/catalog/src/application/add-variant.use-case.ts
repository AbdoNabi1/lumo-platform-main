import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";
import { Sku } from "../domain/value-objects/sku";
import { VariantSelection } from "../domain/value-objects/variant-selection";
import { Variant } from "../domain/variant";

export interface AddVariantInput {
  readonly productId: string;
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
  readonly selection?: Readonly<Record<string, string>>;
}

export interface AddVariantOutput {
  readonly productId: string;
  readonly variantId: string;
}

export interface AddVariantDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Adds a variant to a product's matrix. */
export class AddVariant implements UseCase<AddVariantInput, AddVariantOutput, DomainError> {
  private readonly deps: AddVariantDeps;

  constructor(deps: AddVariantDeps) {
    this.deps = deps;
  }

  async execute(input: AddVariantInput): Promise<Result<AddVariantOutput, DomainError>> {
    const sku = Sku.create(input.sku);
    if (!sku.ok) return err(sku.error);
    const price = Money.create(input.priceAmountMinor, input.currency);
    if (!price.ok) return err(price.error);
    let selection: VariantSelection | null = null;
    if (input.selection !== undefined) {
      const created = VariantSelection.create(input.selection);
      if (!created.ok) return err(created.error);
      selection = created.value;
    }

    return this.deps.unitOfWork.run<Result<AddVariantOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }

      const variantId = UniqueEntityId.from(this.deps.idGenerator.generate());
      const variant = Variant.create(variantId, sku.value, price.value, selection);
      try {
        product.addVariant(variant, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, tx);
      return ok({ productId: product.id.toString(), variantId: variantId.toString() });
    });
  }
}
