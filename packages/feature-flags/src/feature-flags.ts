import type { EvaluationContext } from "./evaluation-context";

/**
 * Evaluates feature flags — decoupling release from deploy and providing kill switches
 * (docs/architecture/12). The production source of truth is the Experimentation context (added
 * later); Phase 1 uses `InMemoryFeatureFlags`.
 *
 * ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter, positioned like every
 * other per-call `tenantId` this WP threads (`findByKey(key, tenantId, tx?)`) — `EvaluationContext`
 * carries no tenant/org field to thread it through instead (see that type's own doc comment).
 */
export interface FeatureFlags {
  isEnabled(key: string, tenantId: string, context: EvaluationContext): Promise<boolean>;
}
