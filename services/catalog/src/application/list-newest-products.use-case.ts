import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Product } from "../domain/product";
import type { NewestProductsReader } from "../domain/product-repository";

export interface ListNewestProductsInput {
  readonly limit: number;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListNewestProductsDeps {
  readonly products: NewestProductsReader;
}

/** The tenant's newest listed (published, not deleted) products, highest id first; `limit` is clamped to 1-50 by the reader. */
export class ListNewestProducts implements UseCase<
  ListNewestProductsInput,
  readonly Product[],
  DomainError
> {
  private readonly deps: ListNewestProductsDeps;

  constructor(deps: ListNewestProductsDeps) {
    this.deps = deps;
  }

  async execute(input: ListNewestProductsInput): Promise<Result<readonly Product[], DomainError>> {
    return ok(await this.deps.products.listNewestListed(input.limit, input.tenantId));
  }
}
