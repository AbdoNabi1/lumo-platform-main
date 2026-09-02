import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface DetachMediaInput {
  readonly productId: string;
  readonly assetId: string;
}

export interface DetachMediaOutput {
  readonly productId: string;
}

export interface DetachMediaDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Detaches a media asset from a product. */
export class DetachMedia implements UseCase<DetachMediaInput, DetachMediaOutput, DomainError> {
  private readonly deps: DetachMediaDeps;

  constructor(deps: DetachMediaDeps) {
    this.deps = deps;
  }

  async execute(input: DetachMediaInput): Promise<Result<DetachMediaOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DetachMediaOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      try {
        product.detachMedia(input.assetId, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
