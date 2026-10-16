import type { UseCase } from "@platform/application";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { BrandRepository } from "../domain/brand-repository";
import type { ProductRepository } from "../domain/product-repository";
import { BrandRef } from "../domain/value-objects/brand-ref";

export interface SetProductBrandInput {
  readonly productId: string;
  readonly brandId: string | null;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface SetProductBrandOutput {
  readonly productId: string;
}

export interface SetProductBrandDeps {
  readonly products: ProductRepository;
  readonly brands: BrandRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

/** Assigns (or clears) a product's brand. */
export class SetProductBrand implements UseCase<
  SetProductBrandInput,
  SetProductBrandOutput,
  DomainError
> {
  private readonly deps: SetProductBrandDeps;

  constructor(deps: SetProductBrandDeps) {
    this.deps = deps;
  }

  async execute(input: SetProductBrandInput): Promise<Result<SetProductBrandOutput, DomainError>> {
    let ref: BrandRef | null = null;
    if (input.brandId !== null) {
      const created = BrandRef.create(input.brandId);
      if (!created.ok) return err(created.error);
      ref = created.value;
    }

    return this.deps.unitOfWork.run<Result<SetProductBrandOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, input.tenantId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      if (ref !== null) {
        const brand = await this.deps.brands.findById(ref.brandId, input.tenantId, tx);
        if (brand === null) {
          return err(new NotFoundError(`Brand not found: ${ref.brandId}`));
        }
      }
      product.setBrand(ref);
      await this.deps.products.save(product, input.tenantId, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
