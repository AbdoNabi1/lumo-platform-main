import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface PublishProductInput {
  readonly productId: string;
}

export interface PublishProductOutput {
  readonly id: string;
}

export interface PublishProductDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Publishes a product (draft → published), emitting `product.published`. */
export class PublishProduct implements UseCase<
  PublishProductInput,
  PublishProductOutput,
  DomainError
> {
  private readonly deps: PublishProductDeps;

  constructor(deps: PublishProductDeps) {
    this.deps = deps;
  }

  async execute(input: PublishProductInput): Promise<Result<PublishProductOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PublishProductOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }

      try {
        product.publish(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.products.save(product, tx);
      return ok({ id: product.id.toString() });
    });
  }
}
