import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { CollectionRepository } from "../domain/collection-repository";

export interface ReorderCollectionProductsInput {
  readonly collectionId: string;
  readonly productIds: readonly string[];
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ReorderCollectionProductsOutput {
  readonly collectionId: string;
}

export interface ReorderCollectionProductsDeps {
  readonly collections: CollectionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Reorders a collection's products (exact-permutation guard). */
export class ReorderCollectionProducts implements UseCase<
  ReorderCollectionProductsInput,
  ReorderCollectionProductsOutput,
  DomainError
> {
  private readonly deps: ReorderCollectionProductsDeps;

  constructor(deps: ReorderCollectionProductsDeps) {
    this.deps = deps;
  }

  async execute(
    input: ReorderCollectionProductsInput,
  ): Promise<Result<ReorderCollectionProductsOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ReorderCollectionProductsOutput, DomainError>>(
      async (tx) => {
        const collection = await this.deps.collections.findById(
          input.collectionId,
          input.tenantId,
          tx,
        );
        if (collection === null) {
          return err(new NotFoundError("Collection not found"));
        }
        try {
          collection.reorderProducts(
            input.productIds,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.collections.save(collection, input.tenantId, tx);
        return ok({ collectionId: collection.id.toString() });
      },
    );
  }
}
