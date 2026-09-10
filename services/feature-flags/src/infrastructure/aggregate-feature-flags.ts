import type { EvaluationContext, FeatureFlags } from "@platform/feature-flags";
import type { FeatureFlagRepository } from "../domain/feature-flag-repository";

export interface AggregateFeatureFlagsDeps {
  readonly flags: FeatureFlagRepository;
  /**
   * ADR-0014: `FeatureFlagRepository.findByKey` now takes `tenantId` per call, but
   * `@platform/feature-flags`'s `FeatureFlags`/`EvaluationContext` contract (a cross-cutting kernel
   * port used by callers well beyond this context) carries no tenant concept at all — widening it
   * is a larger, cross-cutting change than this one context's conversion. Captured at construction
   * instead, the same cross-context/unconverted-caller pattern already used for
   * `apps/admin`'s `PromotionValidationAdapter`. Optional only because the in-memory composition
   * path (tests) has no tenant concept either; the Prisma-backed path always supplies it.
   */
  readonly tenantId?: string;
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
    if (this.deps.tenantId === undefined) {
      throw new Error(
        "AggregateFeatureFlags.isEnabled: tenantId is required (ADR-0014) but this evaluator " +
          "was constructed without one — never default to a placeholder tenant.",
      );
    }
    const flag = await this.deps.flags.findByKey(key, this.deps.tenantId);
    if (flag === null) return false;
    return flag.evaluate(context.subjectId).enabled;
  }
}
