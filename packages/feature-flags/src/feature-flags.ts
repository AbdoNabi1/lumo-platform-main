import type { EvaluationContext } from "./evaluation-context";

/**
 * Evaluates feature flags — decoupling release from deploy and providing kill switches
 * (docs/architecture/12). The production source of truth is the Experimentation context (added
 * later); Phase 1 uses `InMemoryFeatureFlags`.
 */
export interface FeatureFlags {
  isEnabled(key: string, context: EvaluationContext): Promise<boolean>;
}
