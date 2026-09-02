import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CategoryRepository } from "../domain/category-repository";
import type { ProductRepository } from "../domain/product-repository";
import { CategoryRef } from "../domain/value-objects/category-ref";

export interface AssignCategoriesInput {
  readonly productId: string;
  readonly categoryIds: readonly string[];
}

export interface AssignCategoriesOutput {
  readonly productId: string;
}

export interface AssignCategoriesDeps {
  readonly products: ProductRepository;
  readonly categories: CategoryRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Sets a product's category assignments. */
export class AssignCategories implements UseCase<
  AssignCategoriesInput,
  AssignCategoriesOutput,
  DomainError
> {
  private readonly deps: AssignCategoriesDeps;

  constructor(deps: AssignCategoriesDeps) {
    this.deps = deps;
  }

  async execute(
    input: AssignCategoriesInput,
  ): Promise<Result<AssignCategoriesOutput, DomainError>> {
    const refs: CategoryRef[] = [];
    for (const categoryId of input.categoryIds) {
      const created = CategoryRef.create(categoryId);
      if (!created.ok) return err(created.error);
      refs.push(created.value);
    }

    return this.deps.unitOfWork.run<Result<AssignCategoriesOutput, DomainError>>(async (tx) => {
      const product = await this.deps.products.findById(input.productId, tx);
      if (product === null) {
        return err(new NotFoundError("Product not found"));
      }
      for (const ref of refs) {
        const category = await this.deps.categories.findById(ref.categoryId, tx);
        if (category === null) {
          return err(new NotFoundError(`Category not found: ${ref.categoryId}`));
        }
      }
      product.assignCategories(refs, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.products.save(product, tx);
      return ok({ productId: product.id.toString() });
    });
  }
}
