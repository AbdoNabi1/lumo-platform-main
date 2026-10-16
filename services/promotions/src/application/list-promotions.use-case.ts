import type { UseCase } from "@platform/application";
import type { CursorPage, Paginated } from "@platform/types";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { Promotion } from "../domain/promotion";
import type { PromotionRepository } from "../domain/promotion-repository";

export interface ListPromotionsInput extends CursorPage {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export interface ListPromotionsDeps {
  readonly promotions: PromotionRepository;
}

/** Cursor-paginated promotion listing. */
export class ListPromotions implements UseCase<
  ListPromotionsInput,
  Paginated<Promotion>,
  DomainError
> {
  private readonly deps: ListPromotionsDeps;

  constructor(deps: ListPromotionsDeps) {
    this.deps = deps;
  }

  async execute(input: ListPromotionsInput): Promise<Result<Paginated<Promotion>, DomainError>> {
    const { tenantId, ...page } = input;
    return ok(await this.deps.promotions.list(page, tenantId));
  }
}
