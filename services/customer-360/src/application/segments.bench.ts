import { bench, describe } from "vitest";
import type { EvaluationContext } from "@platform/expression";
import { Expr } from "@platform/expression";
import { evaluateRuleSet, type RuleSet } from "@platform/rules";
import { dependentsOf } from "../domain/attribute-dependency";
import type { SegmentDefinition } from "../ports/segment-definition";
import { toSegmentDependencyEdges } from "./evaluate-all-segments.use-case";

/**
 * Segmentation Engine benchmarks — the Phase 6.5 analogue of `computed-attributes.bench.ts`. Same
 * "no compile step exists to cache" ground truth applies here too (`RuleSet<boolean>` is interpreted
 * by the same uncached `evaluateRuleSet`), plus a benchmark specific to this engine: building the
 * fact→segment edge set and running the reused `dependentsOf` closure over it, at registry sizes
 * 10/100/1000/5000 (the brief's explicit performance requirement). Run with `vitest bench`.
 */

function highValueRuleSet(): RuleSet<boolean> {
  return {
    id: "high_value",
    version: 1,
    mode: "first_match",
    rules: [
      {
        id: "high-value-rule",
        priority: 1,
        when: Expr.and(
          Expr.where("profile.lifetime_value", "gte", 1000),
          Expr.where("attributes.churn_risk", "eq", "low"),
          Expr.where("journey.sessionCount", "gt", 1),
        ),
        then: true,
      },
    ],
    fallback: false,
  };
}

const context: EvaluationContext = {
  profile: { lifetime_value: 2500 },
  journey: { sessionCount: 3 },
  attributes: { churn_risk: "low" },
};

describe("evaluateRuleSet — raw boolean segment interpretation cost", () => {
  const ruleSet = highValueRuleSet();

  bench("evaluate a single segment's 1-rule, 3-condition ruleSet", () => {
    evaluateRuleSet(ruleSet, context);
  });

  bench("evaluate the same ruleSet 1000 times in a row (simulates a hot segment)", () => {
    for (let i = 0; i < 1000; i += 1) {
      evaluateRuleSet(ruleSet, context);
    }
  });
});

function generateSegments(size: number): readonly SegmentDefinition[] {
  const factPathCount = Math.max(1, Math.floor(size / 20));
  return Array.from({ length: size }, (_, i) => {
    const path = `profile.field_${i % factPathCount}`;
    return {
      id: `segment_${i}`,
      name: `segment_${i}`,
      version: 1,
      ruleSet: {
        id: `segment_${i}`,
        version: 1,
        mode: "first_match" as const,
        rules: [{ id: "r1", priority: 1, when: Expr.exists(path), then: true }],
        fallback: false,
      },
      createdAt: "t0",
      updatedAt: "t0",
    };
  });
}

describe("RecalculateMemberships — edge construction + incremental closure at scale", () => {
  for (const size of [10, 100, 1000, 5000] as const) {
    const definitions = generateSegments(size);

    bench(`build fact->segment edges for a ${size}-segment registry`, () => {
      toSegmentDependencyEdges(definitions);
    });

    const edges = toSegmentDependencyEdges(definitions);
    bench(`dependentsOf closure for one changed fact path, ${size}-segment registry`, () => {
      dependentsOf(["profile.field_0"], edges);
    });
  }
});
