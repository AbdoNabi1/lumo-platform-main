import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

export interface ListProductsInput extends CursorPage {
  readonly query?: string;
  /** ADR-0014: the caller's verified tenant — never accepted from an unauthenticated source. */
  readonly tenantId: string;
}

export interface ListProductsDeps {
  readonly products: ProductRepository;
}

/**
 * Cursor-paginated product listing; delegates to `search` when a text `query` is given. A
 * case-insensitive substring stopgap (Sprint 7.0 §13) — the real ranked search projection is the
 * Search context's job (ADR-0020), not a competitor built here.
 */
export class ListProducts implements UseCase<ListProductsInput, Paginated<Product>, DomainError> {
  private readonly deps: ListProductsDeps;

  constructor(deps: ListProductsDeps) {
    this.deps = deps;
  }

  async execute(input: ListProductsInput): Promise<Result<Paginated<Product>, DomainError>> {
    const { query, tenantId, ...page } = input;
    return ok(
      query !== undefined
        ? await this.deps.products.search(query, page, tenantId)
        : await this.deps.products.list(page, tenantId),
    );
  }
}
