import type { CreateCategory, CreateCategoryInput } from "../application/create-category.use-case";
import type { DeleteCategory, DeleteCategoryInput } from "../application/delete-category.use-case";
import type { ListCategories, ListCategoriesInput } from "../application/list-categories.use-case";
import type { MoveCategory, MoveCategoryInput } from "../application/move-category.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface CategoryControllerDeps {
  readonly createCategory: CreateCategory;
  readonly moveCategory: MoveCategory;
  readonly deleteCategory: DeleteCategory;
  readonly listCategories: ListCategories;
}

/** Framework-agnostic interface boundary for category use-cases (no HTTP server). */
export class CategoryController {
  private readonly deps: CategoryControllerDeps;

  constructor(deps: CategoryControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateCategoryInput): Promise<ControllerResponse> {
    return present(await this.deps.createCategory.execute(input), 201);
  }

  async move(input: MoveCategoryInput): Promise<ControllerResponse> {
    return present(await this.deps.moveCategory.execute(input), 200);
  }

  async delete(input: DeleteCategoryInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteCategory.execute(input), 200);
  }

  async list(input: ListCategoriesInput): Promise<ControllerResponse> {
    return present(await this.deps.listCategories.execute(input), 200);
  }
}
