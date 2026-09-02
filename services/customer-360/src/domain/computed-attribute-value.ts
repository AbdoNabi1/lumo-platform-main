import type { AttributeValue } from "./attribute-value";
import type { AttributeVersion } from "./attribute-version";

/**
 * One evaluated attribute on a {@link ComputedAttribute} — the Computed Attributes analogue of
 * `ProfileField`. Every value carries its own explainability provenance, non-negotiably (the Phase
 * 6.4 brief's explicit requirement: "every computed attribute must be able to return why its current
 * value is what it is, what its inputs were, what rules fired, and when"):
 *
 * - `value` — the evaluated result (a scalar; see `attribute-value.ts` for why this is a local type).
 * - `definitionId` / `definitionVersion` — which rule set produced this value, and which version of
 *   it — the "what rules" half of explainability at the identity level (the exact rule *bodies* live
 *   on the definition itself, resolvable via `AttributeDefinitionRegistry`; this value only needs to
 *   name which one, the same way `ProfileField.source` names a producer without embedding its logic).
 * - `matchedRuleIds` — which specific rule(s) inside that rule set actually matched, in evaluation
 *   order — directly reusable, not re-derived: `@platform/rules`' `evaluateRuleSet` already returns
 *   this as `RuleSetEvaluation.trace`/`matchedRuleIds`; this field is where that trace's headline
 *   survives past the evaluation call, onto the durable ledger.
 * - `inputs` — the exact evaluation-context facts consulted (flattened to scalars) — the "what were
 *   the inputs" half. Stored per-value (not re-fetched later) because the source facts (a profile
 *   field, a dependency's own value) may themselves have changed since this value was computed;
 *   explainability must describe what was true *then*, not what is true *now*.
 * - `evaluatedAt` — the timestamp half.
 * - `version` — this attribute's own monotonic version, bumped only when its value actually changes
 *   (see `applyAttributeUpdate`'s no-op guard) — the same "freshest fact, not busiest recompute"
 *   discipline `ProfileField.version` already establishes, and the fact that makes incremental
 *   evaluation possible: a dependent only needs recomputing when this number moves.
 */
export interface ComputedAttributeValue {
  readonly value: AttributeValue;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly matchedRuleIds: readonly string[];
  readonly inputs: ReadonlyMap<string, AttributeValue>;
  readonly evaluatedAt: string;
  readonly version: AttributeVersion;
}

export function createComputedAttributeValue(
  value: AttributeValue,
  definitionId: string,
  definitionVersion: number,
  matchedRuleIds: readonly string[],
  inputs: ReadonlyMap<string, AttributeValue>,
  evaluatedAt: string,
  version: AttributeVersion,
): ComputedAttributeValue {
  return { value, definitionId, definitionVersion, matchedRuleIds, inputs, evaluatedAt, version };
}
