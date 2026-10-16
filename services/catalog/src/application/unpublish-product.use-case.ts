import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface UnpublishProductInput {
  readonly productId: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface UnpublishProductOutput {
  readonly productId: string;
}

export interface UnpublishProductDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Unpublishes a product (published -> draft). */
export class UnpublishProduct implements UseCase<
  UnpublishProductInput,
  UnpublishProductOutput,
  DomainError
> {
  private readonly deps: UnpublishProductDeps;

  constructor(deps: UnpublishProductDeps) {
    this.deps = deps;
  }

  async execute(
    input: UnpublishProductInput,
  ): Promise<Result<UnpublishProductOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<UnpublishProductOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      try {
        product.unpublish(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, input.tenantId, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
