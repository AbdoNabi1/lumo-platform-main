import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface UnlistProductInput {
  readonly productId: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface UnlistProductOutput {
  readonly productId: string;
}

export interface UnlistProductDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Unlists a product (sellable by link only — Plan 2C-1). */
export class UnlistProduct implements UseCase<
  UnlistProductInput,
  UnlistProductOutput,
  DomainError
> {
  private readonly deps: UnlistProductDeps;

  constructor(deps: UnlistProductDeps) {
    this.deps = deps;
  }

  async execute(input: UnlistProductInput): Promise<Result<UnlistProductOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<UnlistProductOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      try {
        product.unlist(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, input.tenantId, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
