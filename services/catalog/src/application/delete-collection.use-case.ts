import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { CollectionRepository } from "../domain/collection-repository";

export interface DeleteCollectionInput {
  readonly collectionId: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface DeleteCollectionOutput {
  readonly collectionId: string;
}

export interface DeleteCollectionDeps {
  readonly collections: CollectionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Soft-deletes a collection. */
export class DeleteCollection implements UseCase<
  DeleteCollectionInput,
  DeleteCollectionOutput,
  DomainError
> {
  private readonly deps: DeleteCollectionDeps;

  constructor(deps: DeleteCollectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: DeleteCollectionInput,
  ): Promise<Result<DeleteCollectionOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DeleteCollectionOutput, DomainError>>(async (tx) => {
      const collection = await this.deps.collections.findById(
        input.collectionId,
        input.tenantId,
        tx,
      );
      if (collection === null) {
        return err(new NotFoundError("Collection not found"));
      }
      try {
        collection.delete(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.collections.delete(collection, input.tenantId, tx);
      return ok({ collectionId: collection.id.toString() });
    });
  }
}
