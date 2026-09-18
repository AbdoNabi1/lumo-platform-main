import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Price } from "../domain/price";
import type { PriceRepository } from "../domain/price-repository";

export interface ListPricesInput extends CursorPage {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListPricesDeps {
  readonly prices: PriceRepository;
}

/** Cursor-paginated listing of prices (Sprint 7.0: generic list, no dedicated report names this use-case). */
export class ListPrices implements UseCase<ListPricesInput, Paginated<Price>, DomainError> {
  private readonly deps: ListPricesDeps;

  constructor(deps: ListPricesDeps) {
    this.deps = deps;
  }

  async execute(input: ListPricesInput): Promise<Result<Paginated<Price>, DomainError>> {
    const { tenantId, ...page } = input;
    return ok(await this.deps.prices.list(page, tenantId));
  }
}
