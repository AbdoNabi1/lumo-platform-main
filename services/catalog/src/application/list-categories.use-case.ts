import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Category } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";

export interface ListCategoriesDeps {
  readonly categories: CategoryRepository;
}

/** Cursor-paginated category listing. */
export class ListCategories implements UseCase<CursorPage, Paginated<Category>, DomainError> {
  private readonly deps: ListCategoriesDeps;

  constructor(deps: ListCategoriesDeps) {
    this.deps = deps;
  }

  async execute(input: CursorPage): Promise<Result<Paginated<Category>, DomainError>> {
    return ok(await this.deps.categories.list(input));
  }
}
