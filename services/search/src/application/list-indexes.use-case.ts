import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { SearchIndex } from "../domain/search-index";
import type { SearchIndexRepository } from "../domain/search-index-repository";

export interface ListIndexesInput extends CursorPage {
  readonly tenantId: string;
}

export interface ListIndexesDeps {
  readonly indexes: SearchIndexRepository;
}

/** Cursor-paginated search-index listing — lets an operator see what indexes exist at all. */
export class ListIndexes implements UseCase<ListIndexesInput, Paginated<SearchIndex>, DomainError> {
  private readonly deps: ListIndexesDeps;

  constructor(deps: ListIndexesDeps) {
    this.deps = deps;
  }

  async execute(input: ListIndexesInput): Promise<Result<Paginated<SearchIndex>, DomainError>> {
    return ok(await this.deps.indexes.list(input, input.tenantId));
  }
}
