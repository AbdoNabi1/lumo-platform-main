import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { BusinessRuleError, type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { CategoryRepository } from "../domain/category-repository";

export interface DeleteCategoryInput {
  readonly categoryId: string;
}

export interface DeleteCategoryOutput {
  readonly categoryId: string;
}

export interface DeleteCategoryDeps {
  readonly categories: CategoryRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Soft-deletes a category. Rejected while it has live (non-deleted) children. */
export class DeleteCategory implements UseCase<
  DeleteCategoryInput,
  DeleteCategoryOutput,
  DomainError
> {
  private readonly deps: DeleteCategoryDeps;

  constructor(deps: DeleteCategoryDeps) {
    this.deps = deps;
  }

  async execute(input: DeleteCategoryInput): Promise<Result<DeleteCategoryOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DeleteCategoryOutput, DomainError>>(async (tx) => {
      const category = await this.deps.categories.findById(input.categoryId, tx);
      if (category === null) {
        return err(new NotFoundError("Category not found"));
      }
      const hasChildren = await this.deps.categories.hasChildren(input.categoryId, tx);
      if (hasChildren) {
        return err(new BusinessRuleError("Cannot delete a category with live children"));
      }
      try {
        category.delete(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.categories.delete(category, tx);
      return ok({ categoryId: category.id.toString() });
    });
  }
}
