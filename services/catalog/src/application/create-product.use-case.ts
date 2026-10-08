import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Money, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { usageResourceRegistry, type UsageRecorderPort } from "@platform/usage";
import { type DomainError, isDomainError, ValidationError } from "@platform/utils";
import { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";
import { MediaRef } from "../domain/value-objects/media-ref";
import { Sku } from "../domain/value-objects/sku";
import { Slug } from "../domain/value-objects/slug";
import { Variant } from "../domain/variant";
import { toVariantAttributes, type VariantAttributesInput } from "./variant-attributes-input";

export interface VariantInput extends VariantAttributesInput {
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
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface CreateProductOutput {
  readonly id: string;
}

export interface CreateProductDeps {
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /**
   * G-79 link 1: metering. A created product is written as one `PRODUCT` usage record INSIDE the
   * unit of work (ADR-0003), so the record commits or rolls back with the product. It only records:
   * nothing here compares the count against a limit, so it can never refuse a creation (links 5/6).
   */
  readonly usage: UsageRecorderPort;
}

/** The registry is the source of truth for a resource's unit; a literal here could drift from it. */
const PRODUCT_RESOURCE = "PRODUCT";

function productUnit(): string {
  const definition = usageResourceRegistry.find(PRODUCT_RESOURCE);
  if (definition === null) {
    throw new Error(`Usage resource "${PRODUCT_RESOURCE}" is not in the usage registry`);
  }
  return definition.unit;
}

/** Creates a draft product (with at least one variant) and persists it, recording one unit of usage. */
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

    if (new Set(input.variants.map((v) => v.currency)).size > 1) {
      return err(
        new ValidationError("All variants of a product must use the same currency", [
          { field: "variants", message: "must share one currency" },
        ]),
      );
    }

    const variants: Variant[] = [];
    for (const variant of input.variants) {
      const variantSku = Sku.create(variant.sku);
      if (!variantSku.ok) return err(variantSku.error);
      const price = Money.create(variant.priceAmountMinor, variant.currency);
      if (!price.ok) return err(price.error);
      const attributes = toVariantAttributes(variant, variant.currency);
      if (!attributes.ok) return err(attributes.error);
      try {
        variants.push(
          Variant.create(
            UniqueEntityId.from(this.deps.idGenerator.generate()),
            variantSku.value,
            price.value,
            null,
            attributes.value,
          ),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
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
      await this.deps.products.save(product, input.tenantId, tx);
      await this.deps.usage.record(
        {
          tenant: input.tenantId,
          resource: PRODUCT_RESOURCE,
          amount: 1,
          unit: productUnit(),
          occurredAt: this.deps.clock.now().toISOString(),
          metadata: { productId: id.toString() },
        },
        tx,
      );
      return ok({ id: id.toString() });
    });
  }
}
