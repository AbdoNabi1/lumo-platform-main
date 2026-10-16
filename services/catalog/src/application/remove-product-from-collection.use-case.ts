import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { CollectionRepository } from "../domain/collection-repository";

export interface RemoveProductFromCollectionInput {
  readonly collectionId: string;
  readonly productId: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface RemoveProductFromCollectionOutput {
  readonly collectionId: string;
}

export interface RemoveProductFromCollectionDeps {
  readonly collections: CollectionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Removes a product from a collection. */
export class RemoveProductFromCollection implements UseCase<
  RemoveProductFromCollectionInput,
  RemoveProductFromCollectionOutput,
  DomainError
> {
  private readonly deps: RemoveProductFromCollectionDeps;

  constructor(deps: RemoveProductFromCollectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: RemoveProductFromCollectionInput,
  ): Promise<Result<RemoveProductFromCollectionOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RemoveProductFromCollectionOutput, DomainError>>(
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
          collection.removeProduct(
            input.productId,
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
