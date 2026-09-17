import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { CollectionRepository } from "../domain/collection-repository";

export interface UnpublishCollectionInput {
  readonly collectionId: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface UnpublishCollectionOutput {
  readonly collectionId: string;
}

export interface UnpublishCollectionDeps {
  readonly collections: CollectionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Unpublishes a collection. */
export class UnpublishCollection implements UseCase<
  UnpublishCollectionInput,
  UnpublishCollectionOutput,
  DomainError
> {
  private readonly deps: UnpublishCollectionDeps;

  constructor(deps: UnpublishCollectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: UnpublishCollectionInput,
  ): Promise<Result<UnpublishCollectionOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<UnpublishCollectionOutput, DomainError>>(async (tx) => {
      const collection = await this.deps.collections.findById(
        input.collectionId,
        input.tenantId,
        tx,
      );
      if (collection === null) {
        return err(new NotFoundError("Collection not found"));
      }
      try {
        collection.unpublish(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.collections.save(collection, input.tenantId, tx);
      return ok({ collectionId: collection.id.toString() });
    });
  }
}
