import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface ArchiveProductInput {
  readonly productId: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ArchiveProductOutput {
  readonly productId: string;
}

export interface ArchiveProductDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Archives a product (terminal state). */
export class ArchiveProduct implements UseCase<
  ArchiveProductInput,
  ArchiveProductOutput,
  DomainError
> {
  private readonly deps: ArchiveProductDeps;

  constructor(deps: ArchiveProductDeps) {
    this.deps = deps;
  }

  async execute(input: ArchiveProductInput): Promise<Result<ArchiveProductOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ArchiveProductOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      try {
        product.archive(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
