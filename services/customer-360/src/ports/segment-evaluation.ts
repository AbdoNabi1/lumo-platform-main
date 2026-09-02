import type { RuleTraceEntry } from "@platform/rules";
import type { AttributeValue } from "../domain/attribute-value";
import type { AttributeInputProvenance } from "./attribute-evaluation";
import type { IdentifierRef } from "./identity-decision";

/**
 * The full explainability record for one segment evaluation — the Segmentation analogue of
 * `AttributeEvaluationResult`. Deliberately **not** re-derived from a live rule-set replay: every
 * field here is either the direct output of `@platform/rules`' `evaluateRuleSet` (trace, matched
 * rules, fallback/degraded flags) or a snapshot of the inputs actually consulted, so the explanation
 * describes what was true *at evaluation time*, durable even after the identifier's own facts later
 * change. `isMember` replaces `AttributeEvaluationResult.value` — membership is always boolean-shaped,
 * never a scored or probabilistic outcome (the brief's explicit "no confidence score" requirement).
 */
export interface SegmentEvaluationResult {
  readonly identifier: IdentifierRef;
  readonly segmentId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly isMember: boolean;
  readonly matchedRuleIds: readonly string[];
  readonly usedFallback: boolean;
  /** `true` when at least one rule in the set could not be evaluated (`RuleSet.onError`
   * `"fail_closed"`, the default per ADR-0053 §6) — callers must treat this as "could not fully
   * evaluate", never as silently equivalent to "not a member". */
  readonly degraded: boolean;
  readonly ruleTrace: readonly RuleTraceEntry[];
  /** The exact evaluation-context facts consulted, flattened to scalars — persisted verbatim onto the
   * resulting `SegmentMembership.inputs`. */
  readonly inputs: ReadonlyMap<string, AttributeValue>;
  readonly contributingSources: ReadonlyMap<string, AttributeInputProvenance>;
  /** `segment:<segmentId>` — the Source half of explainability, named as its own field the same way
   * `AttributeEvaluationResult.source` is. */
  readonly source: string;
  readonly evaluatedAt: string;
}

/**
 * The brief's five-part explanation (matched conditions, rule trace, computed attributes used,
 * profile fields used, session fields used), derived entirely from data
 * `SegmentEvaluationResult`/`SegmentMembership` already capture — no additional state is persisted to
 * answer "why is this identifier a member". "Session fields" maps onto the `journey.*` input
 * namespace: per `SEGMENTATION_MODEL.md` §4, there is no separate `session.*` namespace — session
 * facts are already folded into `journey.*` upstream, the same scoping `EvaluateComputedAttribute`
 * establishes.
 */
export interface SegmentExplanation {
  readonly matchedConditions: readonly string[];
  readonly ruleTrace: readonly RuleTraceEntry[];
  readonly computedAttributesUsed: ReadonlyMap<string, AttributeValue>;
  readonly profileFieldsUsed: ReadonlyMap<string, AttributeValue>;
  readonly sessionFieldsUsed: ReadonlyMap<string, AttributeValue>;
}

function byPrefix(
  inputs: ReadonlyMap<string, AttributeValue>,
  prefix: string,
): Map<string, AttributeValue> {
  const result = new Map<string, AttributeValue>();
  for (const [path, value] of inputs) {
    if (path.startsWith(prefix)) result.set(path.slice(prefix.length), value);
  }
  return result;
}

export function explainSegmentEvaluation(result: SegmentEvaluationResult): SegmentExplanation {
  return {
    matchedConditions: result.matchedRuleIds,
    ruleTrace: result.ruleTrace,
    computedAttributesUsed: byPrefix(result.inputs, "attributes."),
    profileFieldsUsed: byPrefix(result.inputs, "profile."),
    sessionFieldsUsed: byPrefix(result.inputs, "journey."),
  };
}
