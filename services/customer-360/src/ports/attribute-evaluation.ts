import type { RuleTraceEntry } from "@platform/rules";
import type { AttributeValue } from "../domain/attribute-value";
import type { IdentifierRef } from "./identity-decision";

/** Where one evaluation-context fact came from, when known — a profile field's own `source`/
 * `updatedAt` (`domain/profile-field.ts`) surfaced onto the evaluation result so explainability can
 * answer "what events/sources fed this" without re-reading the profile. Not every context fact
 * necessarily has one: a dependency attribute's own provenance already lives on its own
 * `ComputedAttributeValue` (reachable via `GetComputedAttributes`), so it is not duplicated here. */
export interface AttributeInputProvenance {
  readonly source: string;
  readonly observedAt: string;
}

/**
 * The full explainability record for one attribute evaluation — the Phase 6.4 brief's explicit
 * requirement that every computed attribute answer why its value is what it is, what fed it, which
 * rules fired, and when. Deliberately **not** re-derived from a live rule-set replay: every field
 * here is either the direct output of `@platform/rules`' `evaluateRuleSet` (trace, matched rules,
 * fallback/degraded flags — nothing reimplemented) or a snapshot of the inputs actually consulted,
 * so the explanation describes what was true *at evaluation time*, durable even after the
 * identifier's own facts later change.
 */
export interface AttributeEvaluationResult {
  readonly identifier: IdentifierRef;
  readonly definitionId: string;
  readonly definitionVersion: number;
  /** `undefined` when no rule matched and the rule set declares no `fallback` — a legitimately
   * absent value (mirrors `RuleSetEvaluation.outcomes` being empty in that same case), never
   * coerced to `null` (which is itself a valid, distinct `AttributeValue`). */
  readonly value: AttributeValue | undefined;
  readonly matchedRuleIds: readonly string[];
  readonly usedFallback: boolean;
  /** `true` when at least one rule in the set could not be evaluated (`RuleSet.onError`
   * `"fail_closed"`, the default per ADR-0053 §6) — callers must treat this as "could not fully
   * evaluate", never as silently equivalent to "no rule matched". */
  readonly degraded: boolean;
  readonly ruleTrace: readonly RuleTraceEntry[];
  /** The exact evaluation-context facts consulted, flattened to scalars — persisted verbatim onto
   * the resulting `ComputedAttributeValue.inputs`. */
  readonly inputs: ReadonlyMap<string, AttributeValue>;
  readonly contributingSources: ReadonlyMap<string, AttributeInputProvenance>;
  /** `computed-attribute:<definitionId>` — the Source half of explainability, named as its own field
   * (rather than making a caller reconstruct it from `definitionId`) so a stored value's provenance
   * reads the same way a `ProfileField.source` does. */
  readonly source: string;
  readonly evaluatedAt: string;
}
