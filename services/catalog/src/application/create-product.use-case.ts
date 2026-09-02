import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";
import { MediaRef } from "../domain/value-objects/media-ref";
import { Sku } from "../domain/value-objects/sku";
import { Slug } from "../domain/value-objects/slug";
import { Variant } from "../domain/variant";

export interface VariantInput {
  readonly sku: string;
  readonly priceAmountMinor: number;
  readonly currency: string;
}

export interface CreateProductInput {
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly variants: readonly VariantInput[];
  readonly mediaAssetIds?: readonly string[];
}

export interface CreateProductOutput {
  readonly id: string;
}

export interface CreateProductDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a draft product (with at least one variant) and persists it. */
export class CreateProduct implements UseCase<
  CreateProductInput,
  CreateProductOutput,
  DomainError
> {
  private readonly deps: CreateProductDeps;

  constructor(deps: CreateProductDeps) {
    this.deps = deps;
  }

  async execute(input: CreateProductInput): Promise<Result<CreateProductOutput, DomainError>> {
    const sku = Sku.create(input.sku);
    if (!sku.ok) return err(sku.error);
    const slug = Slug.create(input.slug);
    if (!slug.ok) return err(slug.error);
    if (input.variants.length === 0) {
      return err(
        new ValidationError("A product needs at least one variant", [
          { field: "variants", message: "at least one is required" },
        ]),
      );
    }

    const variants: Variant[] = [];
    for (const variant of input.variants) {
      const variantSku = Sku.create(variant.sku);
      if (!variantSku.ok) return err(variantSku.error);
      const price = Money.create(variant.priceAmountMinor, variant.currency);
      if (!price.ok) return err(price.error);
      variants.push(
        Variant.create(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          variantSku.value,
          price.value,
        ),
      );
    }

    const media: MediaRef[] = [];
    for (const assetId of input.mediaAssetIds ?? []) {
      const ref = MediaRef.create(assetId);
      if (!ref.ok) return err(ref.error);
      media.push(ref.value);
    }

    return this.deps.unitOfWork.run<Result<CreateProductOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const product = Product.create(
        id,
        { sku: sku.value, name: input.name, slug: slug.value, variants, media },
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.products.save(product, tx);
      return ok({ id: id.toString() });
    });
  }
}
