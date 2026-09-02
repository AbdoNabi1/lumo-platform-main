import { bench, describe } from "vitest";
import type { EvaluationContext } from "@platform/expression";
import { Expr } from "@platform/expression";
import { evaluateRuleSet, type RuleSet } from "@platform/rules";
import type { AttributeValue } from "../domain/attribute-value";

/**
 * Phase 6.4.1 hardening — Task 4 (Rule Compilation Audit) benchmark.
 *
 * There is no compile/parse phase anywhere in `@platform/rules` or `@platform/expression` — a
 * `RuleSet` is already-structured AST data, and `evaluateRuleSet` tree-walks it fresh on every call
 * (`packages/rules/src/evaluate-rules.ts:45-95`; confirmed by a repo-wide search for
 * `compile|cache|memo` across both packages, zero matches). This benchmark measures that raw,
 * uncached interpretation cost in isolation, repeated many times against a fixed ruleset/context —
 * exactly the "does this repeat unnecessarily and is it worth a compile cache" question Task 4 asks.
 * Run with `vitest bench`; numbers captured into `docs/implementation/SPRINT_6_4_1_HARDENING_REPORT.md`.
 */

function fiveRuleTierSet(): RuleSet<AttributeValue> {
  return {
    id: "tier",
    version: 1,
    mode: "first_match",
    rules: [
      {
        id: "platinum",
        priority: 1,
        when: Expr.where("profile.lifetime_value", "gte", 10000),
        then: "platinum",
      },
      {
        id: "gold",
        priority: 2,
        when: Expr.where("profile.lifetime_value", "gte", 5000),
        then: "gold",
      },
      {
        id: "silver",
        priority: 3,
        when: Expr.where("profile.lifetime_value", "gte", 1000),
        then: "silver",
      },
      {
        id: "bronze",
        priority: 4,
        when: Expr.where("profile.lifetime_value", "gte", 100),
        then: "bronze",
      },
      { id: "new", priority: 5, when: Expr.literal(true), then: "new" },
    ],
    fallback: "unknown",
  };
}

const context: EvaluationContext = {
  profile: { lifetime_value: 2500 }, // deliberately falls through 2 rules before matching "silver"
  journey: {},
  attributes: {},
};

describe("evaluateRuleSet — raw interpretation cost (Task 4, no compile step exists to cache)", () => {
  const ruleSet = fiveRuleTierSet();

  bench("evaluate a 5-rule ruleset (first_match, 3rd rule matches)", () => {
    evaluateRuleSet(ruleSet, context);
  });

  bench("evaluate the same ruleset 1000 times in a row (simulates a hot registry entry)", () => {
    for (let i = 0; i < 1000; i += 1) {
      evaluateRuleSet(ruleSet, context);
    }
  });
});
