import { ResourceUrn } from "./value-objects/resource-urn";

/**
 * A declarative **leaf** zero-trust condition — all present predicates must hold for it to fire.
 * Kept structured (not code) so policy is data: versionable, simulatable, explainable (sprint Part 3).
 * Composable boolean logic (AND/OR/NOT/fragments) is layered on top via {@link PolicyExpression}.
 */
export interface PolicyCondition {
  /** Fire only when the evaluated risk is at least this (0–100). */
  readonly minRisk?: number;
  /** Fire only when the evaluated trust is at most this (0–100). */
  readonly maxTrust?: number;
  /** Fire only when device trust is required-and-missing. */
  readonly requireDeviceTrust?: boolean;
  /** Restrict to these environments (e.g. `["production"]`). */
  readonly environments?: readonly string[];
  /** Restrict to resources matching this URN pattern (e.g. `morbeh:finance:*:*`). */
  readonly resource?: string;
}

/** The minimal signals a policy leaf evaluates against ({@link ZeroTrustContext} satisfies this). */
export interface PolicyEvalContext {
  readonly risk: number;
  readonly trust: number;
  readonly deviceTrusted: boolean;
  readonly environment: string | null;
  readonly resource: ResourceUrn | null;
}

/**
 * Evaluates a single leaf condition against the context — the one place leaf-matching lives, shared
 * by both the rule path and the composable {@link PolicyExpression} evaluator (no duplicated logic).
 * Pure and deterministic.
 */
export function evaluateLeaf(condition: PolicyCondition, context: PolicyEvalContext): boolean {
  if (condition.minRisk !== undefined && context.risk < condition.minRisk) return false;
  if (condition.maxTrust !== undefined && context.trust > condition.maxTrust) return false;
  if (condition.requireDeviceTrust === true && context.deviceTrusted) return false; // fires only on untrusted device
  if (
    condition.environments !== undefined &&
    (context.environment === null || !condition.environments.includes(context.environment))
  )
    return false;
  if (condition.resource !== undefined) {
    const pattern = ResourceUrn.parse(condition.resource);
    if (!pattern.ok) return false;
    if (context.resource === null || !context.resource.matches(pattern.value)) return false;
  }
  return true;
}
