import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { CollectionRepository } from "../domain/collection-repository";
import type { ProductRepository } from "../domain/product-repository";

export interface AddProductToCollectionInput {
  readonly collectionId: string;
  readonly productId: string;
}

export interface AddProductToCollectionOutput {
  readonly collectionId: string;
}

export interface AddProductToCollectionDeps {
  readonly collections: CollectionRepository;
  readonly products: ProductRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Adds a product to a collection. */
export class AddProductToCollection implements UseCase<
  AddProductToCollectionInput,
  AddProductToCollectionOutput,
  DomainError
> {
  private readonly deps: AddProductToCollectionDeps;

  constructor(deps: AddProductToCollectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: AddProductToCollectionInput,
  ): Promise<Result<AddProductToCollectionOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<AddProductToCollectionOutput, DomainError>>(
      async (tx) => {
        const collection = await this.deps.collections.findById(input.collectionId, tx);
        if (collection === null) {
          return err(new NotFoundError("Collection not found"));
        }
        const product = await this.deps.products.findById(input.productId, tx);
        if (product === null) {
          return err(new NotFoundError("Product not found"));
        }
        try {
          collection.addProduct(
            input.productId,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.collections.save(collection, tx);
        return ok({ collectionId: collection.id.toString() });
      },
    );
  }
}
