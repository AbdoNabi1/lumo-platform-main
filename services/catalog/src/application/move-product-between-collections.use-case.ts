import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, isDomainError, NotFoundError } from "@platform/utils";
import type { CollectionRepository } from "../domain/collection-repository";

export interface MoveProductBetweenCollectionsInput {
  readonly fromCollectionId: string;
  readonly toCollectionId: string;
  readonly productId: string;
}

export interface MoveProductBetweenCollectionsOutput {
  readonly fromCollectionId: string;
  readonly toCollectionId: string;
}

export interface MoveProductBetweenCollectionsDeps {
  readonly collections: CollectionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Removes a product from one collection and adds it to another — one transaction, two aggregates. */
export class MoveProductBetweenCollections implements UseCase<
  MoveProductBetweenCollectionsInput,
  MoveProductBetweenCollectionsOutput,
  DomainError
> {
  private readonly deps: MoveProductBetweenCollectionsDeps;

  constructor(deps: MoveProductBetweenCollectionsDeps) {
    this.deps = deps;
  }

  async execute(
    input: MoveProductBetweenCollectionsInput,
  ): Promise<Result<MoveProductBetweenCollectionsOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<MoveProductBetweenCollectionsOutput, DomainError>>(
      async (tx) => {
        const from = await this.deps.collections.findById(input.fromCollectionId, tx);
        if (from === null) {
          return err(new NotFoundError("Source collection not found"));
        }
        const to = await this.deps.collections.findById(input.toCollectionId, tx);
        if (to === null) {
          return err(new NotFoundError("Destination collection not found"));
        }

        const now = this.deps.clock.now();
        try {
          from.removeProduct(input.productId, this.deps.idGenerator.generate(), now);
          to.addProduct(input.productId, this.deps.idGenerator.generate(), now);
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.collections.save(from, tx);
        await this.deps.collections.save(to, tx);
        return ok({
          fromCollectionId: from.id.toString(),
          toCollectionId: to.id.toString(),
        });
      },
    );
  }
}
