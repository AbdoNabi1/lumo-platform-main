import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { CollectionRepository } from "../domain/collection-repository";

export interface RenameCollectionInput {
  readonly collectionId: string;
  readonly name: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface RenameCollectionOutput {
  readonly collectionId: string;
  readonly name: string;
}

export interface RenameCollectionDeps {
  readonly collections: CollectionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Renames a collection. */
export class RenameCollection implements UseCase<
  RenameCollectionInput,
  RenameCollectionOutput,
  DomainError
> {
  private readonly deps: RenameCollectionDeps;

  constructor(deps: RenameCollectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: RenameCollectionInput,
  ): Promise<Result<RenameCollectionOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<RenameCollectionOutput, DomainError>>(async (tx) => {
      const collection = await this.deps.collections.findById(
        input.collectionId,
        input.tenantId,
        tx,
      );
      if (collection === null) {
        return err(new NotFoundError("Collection not found"));
      }
      collection.rename(input.name, this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.collections.save(collection, input.tenantId, tx);
      return ok({ collectionId: collection.id.toString(), name: collection.name });
    });
  }
}
