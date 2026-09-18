import type { GetPromotion } from "../application/get-promotion.use-case";
import type { ListPromotions, ListPromotionsInput } from "../application/list-promotions.use-case";
import type {
  AdvancePromotion,
  AdvancePromotionInput,
  CreatePromotion,
  CreatePromotionInput,
  EvaluatePromotions,
  EvaluatePromotionsInput,
  PromotionIdInput,
  RecordPromotionUsage,
} from "../application/promotion.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface PromotionsControllerDeps {
  readonly createPromotion: CreatePromotion;
  readonly advancePromotion: AdvancePromotion;
  readonly evaluatePromotions: EvaluatePromotions;
  readonly recordPromotionUsage: RecordPromotionUsage;
  readonly listPromotions: ListPromotions;
  readonly getPromotion: GetPromotion;
}

/** Framework-agnostic interface boundary for promotions use-cases (no HTTP server). */
export class PromotionsController {
  private readonly deps: PromotionsControllerDeps;

  constructor(deps: PromotionsControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreatePromotionInput): Promise<ControllerResponse> {
    return present(await this.deps.createPromotion.execute(input), 201);
  }

  async advance(input: AdvancePromotionInput): Promise<ControllerResponse> {
    return present(await this.deps.advancePromotion.execute(input), 200);
  }

  async evaluate(input: EvaluatePromotionsInput): Promise<ControllerResponse> {
    return present(await this.deps.evaluatePromotions.execute(input), 200);
  }

  async recordUsage(input: PromotionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.recordPromotionUsage.execute(input), 200);
  }

  async list(input: ListPromotionsInput): Promise<ControllerResponse> {
    return present(await this.deps.listPromotions.execute(input), 200);
  }

  async get(input: PromotionIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getPromotion.execute(input), 200);
  }
}
