import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

export interface GetProductInput {
  readonly productId: string;
}

export interface GetProductDeps {
  readonly products: ProductRepository;
}

/** Fetches a single product by id. */
export class GetProduct implements UseCase<GetProductInput, Product, DomainError> {
  private readonly deps: GetProductDeps;

  constructor(deps: GetProductDeps) {
    this.deps = deps;
  }

  async execute(input: GetProductInput): Promise<Result<Product, DomainError>> {
    const product = await this.deps.products.findById(input.productId);
    return product === null ? err(new NotFoundError("Product not found")) : ok(product);
  }
}
