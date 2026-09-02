import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";
import { MediaRef } from "../domain/value-objects/media-ref";

export interface AttachMediaInput {
  readonly productId: string;
  readonly assetId: string;
}

export interface AttachMediaOutput {
  readonly productId: string;
}

export interface AttachMediaDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Attaches a media asset (by bare id, Media context owns the bytes) to a product. */
export class AttachMedia implements UseCase<AttachMediaInput, AttachMediaOutput, DomainError> {
  private readonly deps: AttachMediaDeps;

  constructor(deps: AttachMediaDeps) {
    this.deps = deps;
  }

  async execute(input: AttachMediaInput): Promise<Result<AttachMediaOutput, DomainError>> {
    const media = MediaRef.create(input.assetId);
    if (!media.ok) return err(media.error);

    return this.deps.unitOfWork.run<Result<AttachMediaOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      try {
        product.attachMedia(media.value, this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.products.save(product, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
