import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Brand } from "../domain/brand";
import type { BrandRepository } from "../domain/brand-repository";

export interface ListBrandsInput extends CursorPage {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListBrandsDeps {
  readonly brands: BrandRepository;
}

/** Cursor-paginated brand listing. */
export class ListBrands implements UseCase<ListBrandsInput, Paginated<Brand>, DomainError> {
  private readonly deps: ListBrandsDeps;

  constructor(deps: ListBrandsDeps) {
    this.deps = deps;
  }

  async execute(input: ListBrandsInput): Promise<Result<Paginated<Brand>, DomainError>> {
    const { tenantId, ...page } = input;
    return ok(await this.deps.brands.list(page, tenantId));
  }
}
