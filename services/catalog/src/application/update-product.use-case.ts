import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";
import { Slug } from "../domain/value-objects/slug";

export interface UpdateProductInput {
  readonly productId: string;
  readonly name: string;
  readonly slug: string;
}

export interface UpdateProductOutput {
  readonly id: string;
}

export interface UpdateProductDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Updates a product's descriptive attributes, emitting `product.updated`. */
export class UpdateProduct implements UseCase<
  UpdateProductInput,
  UpdateProductOutput,
  DomainError
> {
  private readonly deps: UpdateProductDeps;

  constructor(deps: UpdateProductDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateProductInput): Promise<Result<UpdateProductOutput, DomainError>> {
    const slug = Slug.create(input.slug);
    if (!slug.ok) return err(slug.error);

    return this.deps.unitOfWork.run<Result<UpdateProductOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }

      product.update(
        input.name,
        slug.value,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.products.save(product, tx);
      return ok({ id: product.id.toString() });
    });
  }
}
