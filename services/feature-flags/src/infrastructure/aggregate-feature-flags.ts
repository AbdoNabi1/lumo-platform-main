import type { EvaluationContext, FeatureFlags } from "@platform/feature-flags";
import type { FeatureFlagRepository } from "../domain/feature-flag-repository";

export interface AggregateFeatureFlagsDeps {
  readonly flags: FeatureFlagRepository;
}

/**
 * The production source of truth for the existing `@platform/feature-flags` `FeatureFlags` contract
 * (Sprint 5.3) — implements it against this context's own `FeatureFlag` aggregate. The contract and
 * `EvaluationContext` are unmodified (per the report's own "extend, don't duplicate" rule); a flag
 * that doesn't exist evaluates to disabled rather than throwing, matching the contract's own
 * boolean-only surface.
 */
export class AggregateFeatureFlags implements FeatureFlags {
  private readonly deps: AggregateFeatureFlagsDeps;

  constructor(deps: AggregateFeatureFlagsDeps) {
    this.deps = deps;
  }

  async isEnabled(key: string, context: EvaluationContext): Promise<boolean> {
    const flag = await this.deps.flags.findByKey(key);
    if (flag === null) return false;
    return flag.evaluate(context.subjectId).enabled;
  }
}
