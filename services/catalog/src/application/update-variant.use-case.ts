import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, Money } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";
import { Sku } from "../domain/value-objects/sku";
import { VariantSelection } from "../domain/value-objects/variant-selection";
import { toVariantAttributes, type VariantAttributesInput } from "./variant-attributes-input";

export interface UpdateVariantInput extends VariantAttributesInput {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
  /** Plan 2C-1: `undefined` keeps the selection, `null` clears it. */
  readonly selection?: Readonly<Record<string, string>> | null;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface UpdateVariantOutput {
  readonly productId: string;
  readonly variantId: string;
}

export interface UpdateVariantDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * In-place edit of an existing variant (Sprint 7.0 sku/price; Plan 2C-1 attributes and selection).
 * Anything the input leaves out keeps its current value.
 */
export class UpdateVariant implements UseCase<
  UpdateVariantInput,
  UpdateVariantOutput,
  DomainError
> {
  private readonly deps: UpdateVariantDeps;

  constructor(deps: UpdateVariantDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateVariantInput): Promise<Result<UpdateVariantOutput, DomainError>> {
    const sku = Sku.create(input.sku);
    if (!sku.ok) return err(sku.error);
    const price = Money.create(input.priceAmountMinor, input.currency);
    if (!price.ok) return err(price.error);

    return this.deps.unitOfWork.run<Result<UpdateVariantOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      const current = product.variants.find((v) => v.id.toString() === input.variantId);
      if (current === undefined) {
        return err(new BusinessRuleError(`Variant not found: ${input.variantId}`));
      }
      const attributes = toVariantAttributes(input, input.currency, current.attributes);
      if (!attributes.ok) return err(attributes.error);
      let selection = current.selection;
      if (input.selection === null) selection = null;
      else if (input.selection !== undefined) {
        const created = VariantSelection.create(input.selection);
        if (!created.ok) return err(created.error);
        selection = created.value;
      }
      try {
        product.updateVariant(
          input.variantId,
          { sku: sku.value, price: price.value, selection, attributes: attributes.value },
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, input.tenantId, tx);
      return ok({ productId: product.id.toString(), variantId: input.variantId });
    });
  }
}
