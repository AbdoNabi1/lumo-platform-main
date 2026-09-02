import { describe, expect, it } from "vitest";
import { Expr, type EvaluationContext } from "@platform/expression";

import {
  evaluateRuleSet,
  firstOutcome,
  matchedRuleIds,
  RuleEvaluationError,
} from "./evaluate-rules";
import { orderRules, type RuleSet } from "./rule";

type Destination = "meta" | "tiktok" | "google" | "pinterest" | "snap";

const CONTEXT: EvaluationContext = {
  payload: { valueMinor: 150_000, currency: "USD" },
  identity: { country: "sa" },
  consent: { marketing: true },
};

function routing(overrides: Partial<RuleSet<Destination>> = {}): RuleSet<Destination> {
  return {
    id: "destination-routing",
    version: 1,
    mode: "all_matches",
    rules: [
      {
        id: "high-value-meta",
        priority: 10,
        when: Expr.where("payload.valueMinor", "gt", 100_000),
        then: "meta",
      },
      {
        id: "high-value-tiktok",
        priority: 20,
        when: Expr.where("payload.valueMinor", "gt", 100_000),
        then: "tiktok",
      },
      {
        id: "gulf-snap",
        priority: 30,
        when: Expr.in(Expr.ref("identity.country"), ["sa", "ae"]),
        then: "snap",
      },
      {
        id: "low-value-pinterest",
        priority: 40,
        when: Expr.where("payload.valueMinor", "lt", 1000),
        then: "pinterest",
      },
    ],
    ...overrides,
  };
}

describe("rule-set evaluation", () => {
  it("collects every matching outcome in all_matches mode", () => {
    const evaluation = evaluateRuleSet(routing(), CONTEXT);
    expect(evaluation.outcomes).toEqual(["meta", "tiktok", "snap"]);
    expect(evaluation.outcomes).not.toContain("pinterest");
  });

  it("stops at the first match in first_match mode", () => {
    const evaluation = evaluateRuleSet(routing({ mode: "first_match" }), CONTEXT);
    expect(evaluation.outcomes).toEqual(["meta"]);
    expect(firstOutcome(evaluation)).toBe("meta");
  });

  it("evaluates in priority order, ties broken by declaration order", () => {
    const ordered = orderRules([
      { id: "c", priority: 5, when: Expr.literal(true), then: "meta" as Destination },
      { id: "a", priority: 1, when: Expr.literal(true), then: "meta" as Destination },
      { id: "b", priority: 1, when: Expr.literal(true), then: "meta" as Destination },
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("retains disabled rules but never evaluates them", () => {
    const set = routing({
      rules: [
        { id: "off", priority: 1, when: Expr.literal(true), then: "meta", enabled: false },
        { id: "on", priority: 2, when: Expr.literal(true), then: "tiktok" },
      ],
    });
    const evaluation = evaluateRuleSet(set, CONTEXT);
    expect(evaluation.outcomes).toEqual(["tiktok"]);
    expect(evaluation.trace.find((t) => t.ruleId === "off")?.status).toBe("skipped_disabled");
  });

  it("applies the fallback only when nothing matched", () => {
    const set = routing({
      rules: [{ id: "never", priority: 1, when: Expr.literal(false), then: "meta" }],
      fallback: "google",
    });
    const evaluation = evaluateRuleSet(set, CONTEXT);
    expect(evaluation.outcomes).toEqual(["google"]);
    expect(evaluation.usedFallback).toBe(true);
    expect(evaluateRuleSet(routing({ fallback: "google" }), CONTEXT).usedFallback).toBe(false);
  });
});

describe("error policy", () => {
  const broken = (): RuleSet<Destination> =>
    routing({
      rules: [
        { id: "bad", priority: 1, when: Expr.where("missing.path", "gt", 1), then: "meta" },
        { id: "good", priority: 2, when: Expr.literal(true), then: "tiktok" },
      ],
    });

  it("defaults to fail_closed: continues, but marks the evaluation degraded", () => {
    const evaluation = evaluateRuleSet(broken(), CONTEXT);
    expect(evaluation.degraded).toBe(true);
    expect(evaluation.outcomes).toEqual(["tiktok"]);
    expect(evaluation.trace.find((t) => t.ruleId === "bad")?.status).toBe("errored");
  });

  it("skip does not mark the evaluation degraded", () => {
    const evaluation = evaluateRuleSet({ ...broken(), onError: "skip" }, CONTEXT);
    expect(evaluation.degraded).toBe(false);
    expect(evaluation.outcomes).toEqual(["tiktok"]);
  });

  it("fail throws, so one broken rule can be made fatal when a caller needs that", () => {
    expect(() => evaluateRuleSet({ ...broken(), onError: "fail" }, CONTEXT)).toThrow(
      RuleEvaluationError,
    );
  });

  it("keeps 'errored' distinguishable from 'not_matched'", () => {
    const evaluation = evaluateRuleSet(broken(), CONTEXT);
    const statuses = evaluation.trace.map((t) => t.status);
    expect(statuses).toContain("errored");
    expect(statuses).not.toContain("not_matched");
  });
});

describe("trace", () => {
  it("records every considered rule for the inspector", () => {
    const evaluation = evaluateRuleSet(routing(), CONTEXT);
    expect(evaluation.trace).toHaveLength(4);
    expect(matchedRuleIds(evaluation)).toEqual([
      "high-value-meta",
      "high-value-tiktok",
      "gulf-snap",
    ]);
    expect(evaluation.trace.find((t) => t.ruleId === "low-value-pinterest")?.status).toBe(
      "not_matched",
    );
  });

  it("is deterministic across repeated evaluations", () => {
    const runs = Array.from({ length: 20 }, () =>
      JSON.stringify(evaluateRuleSet(routing(), CONTEXT)),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("carries the rule-set identity and version for auditability", () => {
    const evaluation = evaluateRuleSet(routing({ version: 7 }), CONTEXT);
    expect(evaluation.ruleSetId).toBe("destination-routing");
    expect(evaluation.version).toBe(7);
  });
});
