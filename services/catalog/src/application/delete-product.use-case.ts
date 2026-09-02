import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface DeleteProductInput {
  readonly productId: string;
}

export interface DeleteProductOutput {
  readonly productId: string;
}

export interface DeleteProductDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Soft-deletes a product. */
export class DeleteProduct implements UseCase<
  DeleteProductInput,
  DeleteProductOutput,
  DomainError
> {
  private readonly deps: DeleteProductDeps;

  constructor(deps: DeleteProductDeps) {
    this.deps = deps;
  }

  async execute(input: DeleteProductInput): Promise<Result<DeleteProductOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DeleteProductOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      try {
        product.delete(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.delete(product, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
