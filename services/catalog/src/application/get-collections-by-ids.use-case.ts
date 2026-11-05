import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Collection } from "../domain/collection";
import type { CollectionRepository } from "../domain/collection-repository";

/** The most distinct ids one by-ids read looks up (a bounded batch, as pages' by-ids read). */
export const COLLECTIONS_BY_IDS_MAX = 100;

export interface GetCollectionsByIdsInput {
  readonly ids: readonly string[];
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface GetCollectionsByIdsDeps {
  readonly collections: CollectionRepository;
}

/**
 * The tenant's collections among `ids`, in one read (menu link targets). Missing, deleted and
 * foreign ids are skipped; ids past the first {@link COLLECTIONS_BY_IDS_MAX} distinct ones are not
 * looked up, so a caller with more sends several batches.
 */
export class GetCollectionsByIds implements UseCase<
  GetCollectionsByIdsInput,
  readonly Collection[],
  DomainError
> {
  private readonly deps: GetCollectionsByIdsDeps;

  constructor(deps: GetCollectionsByIdsDeps) {
    this.deps = deps;
  }

  async execute(
    input: GetCollectionsByIdsInput,
  ): Promise<Result<readonly Collection[], DomainError>> {
    const ids = [...new Set(input.ids)].slice(0, COLLECTIONS_BY_IDS_MAX);
    if (ids.length === 0) return ok([]);
    return ok(await this.deps.collections.findByIds(ids, input.tenantId));
  }
}
