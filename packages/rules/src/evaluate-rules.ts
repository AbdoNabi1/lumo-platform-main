/**
 * Rule-set evaluation (ADR-0053 §2, §6).
 *
 * Deterministic and side-effect free, like the expression kernel beneath it. The result is a full
 * **trace** rather than a bare outcome: every rule that was considered, whether it matched, and
 * why it errored. A routing decision a merchant cannot explain is a routing decision they cannot
 * trust, and the trace is what the Live Event Inspector renders.
 */

import { evaluate, type EvaluationContext, type EvaluationError } from "@platform/expression";

import { isRuleEnabled, orderRules, type Rule, type RuleSet } from "./rule";

/** What happened to one rule during evaluation. */
export type RuleOutcomeStatus = "matched" | "not_matched" | "skipped_disabled" | "errored";

export interface RuleTraceEntry {
  readonly ruleId: string;
  readonly status: RuleOutcomeStatus;
  readonly error?: EvaluationError;
}

export interface RuleSetEvaluation<TOutcome> {
  readonly ruleSetId: string;
  readonly version: number;
  /** Outcomes of matched rules, in evaluation order. Empty when nothing matched. */
  readonly outcomes: readonly TOutcome[];
  /** True when the fallback supplied the outcome because no rule matched. */
  readonly usedFallback: boolean;
  /**
   * True when at least one rule could not be evaluated and the policy was `fail_closed`. Callers
   * gating on consent, spend or security must treat this as a denial, not as "no match".
   */
  readonly degraded: boolean;
  readonly trace: readonly RuleTraceEntry[];
}

/**
 * Evaluates a rule set against a context.
 *
 * The `fail` error policy throws, which is intentionally the *non-default*: a single malformed rule
 * should not take down an entire event pipeline. `fail_closed` (the default) records the failure,
 * marks the evaluation degraded and continues, so the caller decides how much a broken rule costs.
 */
export function evaluateRuleSet<TOutcome>(
  ruleSet: RuleSet<TOutcome>,
  context: EvaluationContext,
): RuleSetEvaluation<TOutcome> {
  const policy = ruleSet.onError ?? "fail_closed";
  const outcomes: TOutcome[] = [];
  const trace: RuleTraceEntry[] = [];
  let degraded = false;

  for (const rule of orderRules(ruleSet.rules)) {
    if (!isRuleEnabled(rule)) {
      trace.push({ ruleId: rule.id, status: "skipped_disabled" });
      continue;
    }

    const result = evaluate(rule.when, context);

    if (!result.ok) {
      trace.push({ ruleId: rule.id, status: "errored", error: result.error });

      if (policy === "fail") {
        throw new RuleEvaluationError(ruleSet.id, rule.id, result.error);
      }
      if (policy === "fail_closed") {
        degraded = true;
      }
      continue;
    }

    if (!result.value) {
      trace.push({ ruleId: rule.id, status: "not_matched" });
      continue;
    }

    trace.push({ ruleId: rule.id, status: "matched" });
    outcomes.push(rule.then);

    if (ruleSet.mode === "first_match") break;
  }

  const usedFallback = outcomes.length === 0 && ruleSet.fallback !== undefined;

  return {
    ruleSetId: ruleSet.id,
    version: ruleSet.version,
    outcomes: usedFallback && ruleSet.fallback !== undefined ? [ruleSet.fallback] : outcomes,
    usedFallback,
    degraded,
    trace,
  };
}

/** Thrown only under the explicit `fail` error policy. */
export class RuleEvaluationError extends Error {
  constructor(
    readonly ruleSetId: string,
    readonly ruleId: string,
    readonly evaluationError: EvaluationError,
  ) {
    super(`rule ${ruleId} in set ${ruleSetId} failed: ${evaluationError.code}`);
    this.name = "RuleEvaluationError";
  }
}

/** Convenience for `first_match` sets: the single outcome, or undefined. */
export function firstOutcome<TOutcome>(
  evaluation: RuleSetEvaluation<TOutcome>,
): TOutcome | undefined {
  return evaluation.outcomes[0];
}

/** Every rule that matched, for diagnostics. */
export function matchedRuleIds<TOutcome>(
  evaluation: RuleSetEvaluation<TOutcome>,
): readonly string[] {
  return evaluation.trace.filter((e) => e.status === "matched").map((e) => e.ruleId);
}

/** Structural check of every rule's condition, for authoring-time validation. */
export function findUnevaluableRules<TOutcome>(
  ruleSet: RuleSet<TOutcome>,
  context: EvaluationContext,
): readonly Rule<TOutcome>[] {
  return ruleSet.rules.filter((rule) => isRuleEnabled(rule) && !evaluate(rule.when, context).ok);
}
