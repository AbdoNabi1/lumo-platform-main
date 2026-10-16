import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Collection } from "../domain/collection";
import type { CollectionRepository } from "../domain/collection-repository";

export interface GetCollectionBySlugInput {
  readonly slug: string;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface GetCollectionBySlugDeps {
  readonly collections: CollectionRepository;
}

/** Fetches a single collection by slug — the storefront's collection-detail lookup. */
export class GetCollectionBySlug implements UseCase<
  GetCollectionBySlugInput,
  Collection,
  DomainError
> {
  private readonly deps: GetCollectionBySlugDeps;

  constructor(deps: GetCollectionBySlugDeps) {
    this.deps = deps;
  }

  async execute(input: GetCollectionBySlugInput): Promise<Result<Collection, DomainError>> {
    const collection = await this.deps.collections.findBySlug(input.slug, input.tenantId);
    return collection === null ? err(new NotFoundError("Collection not found")) : ok(collection);
  }
}
