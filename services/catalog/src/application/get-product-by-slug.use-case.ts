import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

export interface GetProductBySlugInput {
  readonly slug: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface GetProductBySlugDeps {
  readonly products: ProductRepository;
}

/** Fetches a single product by slug — the storefront's product-detail lookup. */
export class GetProductBySlug implements UseCase<GetProductBySlugInput, Product, DomainError> {
  private readonly deps: GetProductBySlugDeps;

  constructor(deps: GetProductBySlugDeps) {
    this.deps = deps;
  }

  async execute(input: GetProductBySlugInput): Promise<Result<Product, DomainError>> {
    const product = await this.deps.products.findBySlug(input.slug, input.tenantId);
    return product === null ? err(new NotFoundError("Product not found")) : ok(product);
  }
}
