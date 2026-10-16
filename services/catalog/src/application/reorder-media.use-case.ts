import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface ReorderMediaInput {
  readonly productId: string;
  readonly assetIds: readonly string[];
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ReorderMediaOutput {
  readonly productId: string;
}

export interface ReorderMediaDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Reorders a product's attached media (exact-permutation guard). */
export class ReorderMedia implements UseCase<ReorderMediaInput, ReorderMediaOutput, DomainError> {
  private readonly deps: ReorderMediaDeps;

  constructor(deps: ReorderMediaDeps) {
    this.deps = deps;
  }

  async execute(input: ReorderMediaInput): Promise<Result<ReorderMediaOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ReorderMediaOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      try {
        product.reorderMedia(
          input.assetIds,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, input.tenantId, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
