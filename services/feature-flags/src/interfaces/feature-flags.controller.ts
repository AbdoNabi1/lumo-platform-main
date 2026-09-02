import type { CursorPage } from "@platform/types";
import type {
  AddFeatureRule,
  AddFeatureRuleInput,
  AdvanceFlag,
  AdvanceFlagInput,
  CreateFeatureFlag,
  CreateFeatureFlagInput,
  FlagIdInput,
  SetEnvironmentOverride,
  SetEnvironmentOverrideInput,
  SetRolloutPercentage,
  SetRolloutPercentageInput,
} from "../application/feature-flag.use-cases";
import type { GetFeatureFlag } from "../application/get-feature-flag.use-case";
import type { ListFeatureFlags } from "../application/list-feature-flags.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface FeatureFlagsControllerDeps {
  readonly createFlag: CreateFeatureFlag;
  readonly advanceFlag: AdvanceFlag;
  readonly setRolloutPercentage: SetRolloutPercentage;
  readonly addRule: AddFeatureRule;
  readonly setEnvironmentOverride: SetEnvironmentOverride;
  readonly listFeatureFlags: ListFeatureFlags;
  readonly getFeatureFlag: GetFeatureFlag;
}

/** Framework-agnostic interface boundary for feature-flags use-cases (no HTTP server). */
export class FeatureFlagsController {
  private readonly deps: FeatureFlagsControllerDeps;

  constructor(deps: FeatureFlagsControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateFeatureFlagInput): Promise<ControllerResponse> {
    return present(await this.deps.createFlag.execute(input), 201);
  }

  async advance(input: AdvanceFlagInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceFlag.execute(input), 200);
  }

  async setRollout(input: SetRolloutPercentageInput): Promise<ControllerResponse> {
    return present(await this.deps.setRolloutPercentage.execute(input), 200);
  }

  async addRule(input: AddFeatureRuleInput): Promise<ControllerResponse> {
    return present(await this.deps.addRule.execute(input), 200);
  }

  async setEnvironmentOverride(input: SetEnvironmentOverrideInput): Promise<ControllerResponse> {
    return present(await this.deps.setEnvironmentOverride.execute(input), 200);
  }

  async list(input: CursorPage): Promise<ControllerResponse> {
    return present(await this.deps.listFeatureFlags.execute(input), 200);
  }

  async get(input: FlagIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getFeatureFlag.execute(input), 200);
  }
}
