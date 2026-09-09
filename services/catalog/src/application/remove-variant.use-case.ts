import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface RemoveVariantInput {
  readonly productId: string;
  readonly variantId: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface RemoveVariantOutput {
  readonly productId: string;
}

export interface RemoveVariantDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Removes a variant from a product's matrix (at least one variant must remain). */
export class RemoveVariant implements UseCase<
  RemoveVariantInput,
  RemoveVariantOutput,
  DomainError
> {
  private readonly deps: RemoveVariantDeps;

  constructor(deps: RemoveVariantDeps) {
    this.deps = deps;
  }

  async execute(input: RemoveVariantInput): Promise<Result<RemoveVariantOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RemoveVariantOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      try {
        product.removeVariant(
          input.variantId,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
