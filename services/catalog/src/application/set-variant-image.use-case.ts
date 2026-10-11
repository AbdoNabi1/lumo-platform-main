import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";

export interface SetVariantImageInput {
  readonly productId: string;
  readonly variantId: string;
  /** One of the product's own media, or `null` to clear the variant's image. */
  readonly mediaId: string | null;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface SetVariantImageOutput {
  readonly productId: string;
  readonly variantId: string;
}

export interface SetVariantImageDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Shopify "variant image": the storefront shows this media when the shopper picks the variant. */
export class SetVariantImage implements UseCase<
  SetVariantImageInput,
  SetVariantImageOutput,
  DomainError
> {
  private readonly deps: SetVariantImageDeps;

  constructor(deps: SetVariantImageDeps) {
    this.deps = deps;
  }

  async execute(input: SetVariantImageInput): Promise<Result<SetVariantImageOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<SetVariantImageOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) return err(new NotFoundError("Product not found"));
      try {
        product.setVariantImage(
          input.variantId,
          input.mediaId,
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
