import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Category } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";

export interface ListCategoriesInput extends CursorPage {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListCategoriesDeps {
  readonly categories: CategoryRepository;
}

/** Cursor-paginated category listing. */
export class ListCategories implements UseCase<
  ListCategoriesInput,
  Paginated<Category>,
  DomainError
> {
  private readonly deps: ListCategoriesDeps;

  constructor(deps: ListCategoriesDeps) {
    this.deps = deps;
  }

  async execute(input: ListCategoriesInput): Promise<Result<Paginated<Category>, DomainError>> {
    const { tenantId, ...page } = input;
    return ok(await this.deps.categories.list(page, tenantId));
  }
}
