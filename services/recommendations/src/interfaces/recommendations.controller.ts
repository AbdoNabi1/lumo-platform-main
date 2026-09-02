import type { CursorPage } from "@platform/types";
import type { GetModel } from "../application/get-model.use-case";
import type { ListModels } from "../application/list-models.use-case";
import type {
  AdvanceModel,
  AdvanceModelInput,
  CreateModel,
  CreateModelInput,
  GenerateRecommendationSet,
  GenerateSetInput,
  ModelIdInput,
  RegenerateRecommendationSet,
  RegenerateSetInput,
} from "../application/recommendation.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface RecommendationsControllerDeps {
  readonly createModel: CreateModel;
  readonly advanceModel: AdvanceModel;
  readonly generateSet: GenerateRecommendationSet;
  readonly regenerateSet: RegenerateRecommendationSet;
  readonly listModels: ListModels;
  readonly getModel: GetModel;
}

/** Framework-agnostic interface boundary for recommendations use-cases (no HTTP server). */
export class RecommendationsController {
  private readonly deps: RecommendationsControllerDeps;

  constructor(deps: RecommendationsControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateModelInput): Promise<ControllerResponse> {
    return present(await this.deps.createModel.execute(input), 201);
  }

  async advance(input: AdvanceModelInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceModel.execute(input), 200);
  }

  async generate(input: GenerateSetInput): Promise<ControllerResponse> {
    return present(await this.deps.generateSet.execute(input), 200);
  }

  async regenerate(input: RegenerateSetInput): Promise<ControllerResponse> {
    return present(await this.deps.regenerateSet.execute(input), 200);
  }

  async list(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listModels.execute(input), 200);
  }

  async get(input: ModelIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getModel.execute(input), 200);
  }
}
