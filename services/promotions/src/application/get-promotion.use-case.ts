import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Promotion } from "../domain/promotion";
import type { PromotionRepository } from "../domain/promotion-repository";
import type { PromotionIdInput } from "./promotion.use-cases";

export interface GetPromotionDeps {
  readonly promotions: PromotionRepository;
}

/** Fetches a single promotion by id. */
export class GetPromotion implements UseCase<PromotionIdInput, Promotion, DomainError> {
  private readonly deps: GetPromotionDeps;

  constructor(deps: GetPromotionDeps) {
    this.deps = deps;
  }

  async execute(input: PromotionIdInput): Promise<Result<Promotion, DomainError>> {
    const promotion = await this.deps.promotions.findById(input.promotionId);
    return promotion === null ? err(new NotFoundError("Promotion not found")) : ok(promotion);
  }
}
