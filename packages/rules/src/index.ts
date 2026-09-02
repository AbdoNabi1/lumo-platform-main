/**
 * `@platform/rules` — rule and rule-set evaluation on the Engine Kernel (ADR-0053).
 *
 * Pure, deterministic and side-effect free. Outcomes are opaque to the kernel, so tracking's
 * destination routing, promotions, pricing, automation and entitlements all compose the same
 * engine without any of them leaking into it.
 */

export type { Rule, RuleSet, RuleSetMode, RuleErrorPolicy } from "./rule";
export { orderRules, isRuleEnabled } from "./rule";

export type { RuleOutcomeStatus, RuleTraceEntry, RuleSetEvaluation } from "./evaluate-rules";
export {
  evaluateRuleSet,
  RuleEvaluationError,
  firstOutcome,
  matchedRuleIds,
  findUnevaluableRules,
} from "./evaluate-rules";
