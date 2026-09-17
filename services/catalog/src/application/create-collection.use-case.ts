import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConflictError, type DomainError } from "@platform/utils";
import { Collection } from "../domain/collection";
import type { CollectionRepository } from "../domain/collection-repository";
import { Slug } from "../domain/value-objects/slug";

export interface CreateCollectionInput {
  readonly name: string;
  readonly slug: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface CreateCollectionOutput {
  readonly id: string;
}

export interface CreateCollectionDeps {
  readonly collections: CollectionRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a manual, merchant-curated collection (slug is the natural key). */
export class CreateCollection implements UseCase<
  CreateCollectionInput,
  CreateCollectionOutput,
  DomainError
> {
  private readonly deps: CreateCollectionDeps;

  constructor(deps: CreateCollectionDeps) {
    this.deps = deps;
  }

  async execute(
    input: CreateCollectionInput,
  ): Promise<Result<CreateCollectionOutput, DomainError>> {
    const slug = Slug.create(input.slug);
    if (!slug.ok) return err(slug.error);
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<CreateCollectionOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.collections.findBySlug(slug.value.value, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError("A collection with this slug already exists"));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const collection = Collection.create(
        id,
        input.name,
        slug.value,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.collections.save(collection, input.tenantId, tx);
      return ok({ id: id.toString() });
    });
  }
}
