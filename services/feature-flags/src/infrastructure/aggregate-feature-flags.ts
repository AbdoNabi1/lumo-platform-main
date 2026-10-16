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
 *
 * ADR-0014 (WP-10, T10.3): built once, as a process-wide singleton — `tenantId` is a `isEnabled`
 * per-call parameter (matching `FeatureFlagRepository.findByKey`), never captured at construction.
 */
export class AggregateFeatureFlags implements FeatureFlags {
  private readonly deps: AggregateFeatureFlagsDeps;

  constructor(deps: AggregateFeatureFlagsDeps) {
    this.deps = deps;
  }

  async isEnabled(key: string, tenantId: string, context: EvaluationContext): Promise<boolean> {
    if (!tenantId) {
      throw new Error(
        "AggregateFeatureFlags.isEnabled: tenantId is required (ADR-0014) and must come from the " +
          "request's resolved tenant — never default to a placeholder or evaluate without one. A " +
          "flag evaluated under the wrong (or no) tenant is a wrong rollout or a wrong entitlement.",
      );
    }
    const flag = await this.deps.flags.findByKey(key, tenantId);
    if (flag === null) return false;
    return flag.evaluate(context.subjectId).enabled;
  }
}
