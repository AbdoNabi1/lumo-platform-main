import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Product } from "../domain/product";
import type { ProductBatchReader } from "../domain/product-repository";

export interface GetProductsByIdsInput {
  readonly ids: readonly string[];
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface GetProductsByIdsDeps {
  readonly products: ProductBatchReader;
}

/** The tenant's products among `ids`, in one read. Missing, deleted and foreign ids are skipped. */
export class GetProductsByIds implements UseCase<
  GetProductsByIdsInput,
  readonly Product[],
  DomainError
> {
  private readonly deps: GetProductsByIdsDeps;

  constructor(deps: GetProductsByIdsDeps) {
    this.deps = deps;
  }

  async execute(input: GetProductsByIdsInput): Promise<Result<readonly Product[], DomainError>> {
    if (input.ids.length === 0) return ok([]);
    return ok(await this.deps.products.findByIds(input.ids, input.tenantId));
  }
}
