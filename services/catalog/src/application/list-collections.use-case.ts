import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Collection } from "../domain/collection";
import type { CollectionRepository } from "../domain/collection-repository";

export interface ListCollectionsInput extends CursorPage {
  readonly query?: string;
}

export interface ListCollectionsDeps {
  readonly collections: CollectionRepository;
}

/** Cursor-paginated collection listing; delegates to `search` when a text `query` is given. */
export class ListCollections implements UseCase<
  ListCollectionsInput,
  Paginated<Collection>,
  DomainError
> {
  private readonly deps: ListCollectionsDeps;

  constructor(deps: ListCollectionsDeps) {
    this.deps = deps;
  }

  async execute(input: ListCollectionsInput): Promise<Result<Paginated<Collection>, DomainError>> {
    const { query, ...page } = input;
    return ok(
      query !== undefined
        ? await this.deps.collections.search(query, page)
        : await this.deps.collections.list(page),
    );
  }
}
