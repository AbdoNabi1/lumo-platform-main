/**
 * Rule and rule-set model (ADR-0053 §2).
 *
 * A rule pairs a condition with an **opaque, caller-defined outcome**. The kernel never interprets
 * an outcome: routing decisions, policy effects and segment membership are all the consumer's
 * types. That is what keeps one rule engine usable by tracking, promotions, pricing, automation
 * and entitlements without any of them leaking into the kernel.
 */

import type { Expression } from "@platform/expression";

/** How a rule set resolves multiple matches. */
export type RuleSetMode = "first_match" | "all_matches";

/** What to do when a rule's condition cannot be evaluated at all. */
export type RuleErrorPolicy = "skip" | "fail_closed" | "fail";

export interface Rule<TOutcome> {
  readonly id: string;
  /** Lower numbers evaluate first. Ties resolve by declaration order, so ordering is total. */
  readonly priority: number;
  readonly when: Expression;
  readonly then: TOutcome;
  /** Disabled rules are retained (history is never lost) but never evaluated. */
  readonly enabled?: boolean;
  readonly description?: string;
}

export interface RuleSet<TOutcome> {
  readonly id: string;
  readonly version: number;
  readonly mode: RuleSetMode;
  readonly rules: readonly Rule<TOutcome>[];
  /**
   * How an unevaluable condition is treated. Defaults to `fail_closed` — for a routing or consent
   * decision, a rule that could not be evaluated must not be silently treated as "no match".
   */
  readonly onError?: RuleErrorPolicy;
  /** Outcome when no rule matches. */
  readonly fallback?: TOutcome;
}

/** Orders rules by priority, then by declaration order, without mutating the input. */
export function orderRules<TOutcome>(rules: readonly Rule<TOutcome>[]): readonly Rule<TOutcome>[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index)
    .map(({ rule }) => rule);
}

/** A rule is evaluated unless explicitly disabled. */
export function isRuleEnabled<TOutcome>(rule: Rule<TOutcome>): boolean {
  return rule.enabled !== false;
}
