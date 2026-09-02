import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { CollectionRepository } from "../domain/collection-repository";

export interface PublishCollectionInput {
  readonly collectionId: string;
}

export interface PublishCollectionOutput {
  readonly collectionId: string;
}

export interface PublishCollectionDeps {
  readonly collections: CollectionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Publishes a collection. */
export class PublishCollection implements UseCase<
  PublishCollectionInput,
  PublishCollectionOutput,
  DomainError
> {
  private readonly deps: PublishCollectionDeps;

  constructor(deps: PublishCollectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: PublishCollectionInput,
  ): Promise<Result<PublishCollectionOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<PublishCollectionOutput, DomainError>>(async (tx) => {
      const collection = await this.deps.collections.findById(input.collectionId, tx);
      if (collection === null) {
        return err(new NotFoundError("Collection not found"));
      }
      try {
        collection.publish(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.collections.save(collection, tx);
      return ok({ collectionId: collection.id.toString() });
    });
  }
}
