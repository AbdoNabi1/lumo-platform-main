import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Money } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";
import { Sku } from "../domain/value-objects/sku";

export interface UpdateVariantInput {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
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

/** In-place sku/price edit for an existing variant (Sprint 7.0 — `selection` never changes). */
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
      try {
        product.updateVariant(
          input.variantId,
          sku.value,
          price.value,
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
