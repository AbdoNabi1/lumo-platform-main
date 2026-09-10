import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { SearchIndex } from "../domain/search-index";
import type { SearchIndexRepository } from "../domain/search-index-repository";
import type { IndexIdInput } from "./search.use-cases";

export interface GetIndexDeps {
  readonly indexes: SearchIndexRepository;
}

/** Fetches a single search index by id. */
export class GetIndex implements UseCase<IndexIdInput, SearchIndex, DomainError> {
  private readonly deps: GetIndexDeps;

  constructor(deps: GetIndexDeps) {
    this.deps = deps;
  }

  async execute(input: IndexIdInput): Promise<Result<SearchIndex, DomainError>> {
    const index = await this.deps.indexes.findById(input.indexId, input.tenantId);
    return index === null ? err(new NotFoundError("Search index not found")) : ok(index);
  }
}
