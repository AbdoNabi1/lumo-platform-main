import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { ProductRepository } from "../domain/product-repository";
import { ProductDetails } from "../domain/value-objects/product-details";
import { Slug } from "../domain/value-objects/slug";

export interface UpdateProductInput {
  readonly productId: string;
  readonly name: string;
  readonly slug: string;
  /** Plan 2C-1 — each optional: `undefined` keeps, `null`/`[]` clears. */
  readonly description?: string | null;
  readonly productType?: string | null;
  readonly tags?: readonly string[];
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
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
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }

      // Validate the details BEFORE touching the aggregate, so an invalid body changes nothing.
      let details: ProductDetails | null = null;
      if (
        input.description !== undefined ||
        input.productType !== undefined ||
        input.tags !== undefined
      ) {
        const created = ProductDetails.create({
          description:
            input.description === undefined ? product.details.description : input.description,
          productType:
            input.productType === undefined ? product.details.productType : input.productType,
          tags: input.tags ?? product.details.tags,
        });
        if (!created.ok) return err(created.error);
        details = created.value;
      }

      product.update(
        input.name,
        slug.value,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      if (details !== null) product.setDetails(details);
      await this.deps.products.save(product, input.tenantId, tx);
      return ok({ id: product.id.toString() });
    });
  }
}
