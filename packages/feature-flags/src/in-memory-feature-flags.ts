import type { EvaluationContext } from "./evaluation-context";
import type { FeatureFlags } from "./feature-flags";

/**
 * In-memory `FeatureFlags` backed by a static key→enabled map. Unknown keys are disabled (a safe
 * default and kill-switch semantics). The evaluation context is ignored — there is no rollout,
 * percentage hashing, multivariate evaluation, or targeting yet (that belongs to the future
 * Experimentation implementation). For local development and tests.
 */
export class InMemoryFeatureFlags implements FeatureFlags {
  private readonly flags: ReadonlyMap<string, boolean>;

  constructor(flags: Readonly<Record<string, boolean>> = {}) {
    this.flags = new Map(Object.entries(flags));
  }

  isEnabled(key: string, _context: EvaluationContext): Promise<boolean> {
    return Promise.resolve(this.flags.get(key) ?? false);
  }
}
