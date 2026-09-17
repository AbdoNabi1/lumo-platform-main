import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import { Category } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";
import { Slug } from "../domain/value-objects/slug";

export interface CreateCategoryInput {
  readonly name: string;
  readonly slug: string;
  readonly parentId?: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface CreateCategoryOutput {
  readonly id: string;
}

export interface CreateCategoryDeps {
  readonly categories: CategoryRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a category, optionally under a parent (Commerce Sprint 1: parent + existence check). */
export class CreateCategory implements UseCase<
  CreateCategoryInput,
  CreateCategoryOutput,
  DomainError
> {
  private readonly deps: CreateCategoryDeps;

  constructor(deps: CreateCategoryDeps) {
    this.deps = deps;
  }

  async execute(input: CreateCategoryInput): Promise<Result<CreateCategoryOutput, DomainError>> {
    const slug = Slug.create(input.slug);
    if (!slug.ok) return err(slug.error);

    return this.deps.unitOfWork.run<Result<CreateCategoryOutput, DomainError>>(async (tx) => {
      if (input.parentId !== undefined) {
        const parent = await this.deps.categories.findById(input.parentId, input.tenantId, tx);
        if (parent === null) {
          return err(new NotFoundError(`Parent category not found: ${input.parentId}`));
        }
      }

      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const category = Category.create(
        id,
        input.name,
        slug.value,
        input.parentId ?? null,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.categories.save(category, input.tenantId, tx);
      return ok({ id: id.toString() });
    });
  }
}
