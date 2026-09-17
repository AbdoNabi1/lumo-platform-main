import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { CategoryRepository } from "../domain/category-repository";

export interface MoveCategoryInput {
  readonly categoryId: string;
  readonly newParentId: string | null;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface MoveCategoryOutput {
  readonly categoryId: string;
  readonly newParentId: string | null;
}

export interface MoveCategoryDeps {
  readonly categories: CategoryRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Reparents a category. Walks the full ancestor chain of the new parent to reject any cycle. */
export class MoveCategory implements UseCase<MoveCategoryInput, MoveCategoryOutput, DomainError> {
  private readonly deps: MoveCategoryDeps;

  constructor(deps: MoveCategoryDeps) {
    this.deps = deps;
  }

  async execute(input: MoveCategoryInput): Promise<Result<MoveCategoryOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<MoveCategoryOutput, DomainError>>(async (tx) => {
      const category = await this.deps.categories.findById(input.categoryId, input.tenantId, tx);
      if (category === null) {
        return err(new NotFoundError("Category not found"));
      }

      const ancestorIds: string[] = [];
      let cursor = input.newParentId;
      while (cursor !== null) {
        ancestorIds.push(cursor);
        const parent = await this.deps.categories.findById(cursor, input.tenantId, tx);
        if (parent === null) {
          return err(new NotFoundError(`Parent category not found: ${cursor}`));
        }
        cursor = parent.parentId;
      }

      try {
        category.moveTo(
          input.newParentId,
          ancestorIds,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.categories.save(category, input.tenantId, tx);
      return ok({ categoryId: category.id.toString(), newParentId: input.newParentId });
    });
  }
}
