import { describe, expect, it } from "vitest";
import {
  PolicyExpressionEvaluator,
  type FragmentResolver,
  type PolicyExpression,
} from "./policy-expression";
import type { PolicyEvalContext } from "./policy-condition";

const ctx = (over: Partial<PolicyEvalContext> = {}): PolicyEvalContext => ({
  risk: 0,
  trust: 100,
  deviceTrusted: true,
  environment: "production",
  resource: null,
  ...over,
});

describe("PolicyExpressionEvaluator (composable policy language §8)", () => {
  const evaluator = new PolicyExpressionEvaluator();

  it("evaluates leaf, AND, OR and NOT", () => {
    const highRisk: PolicyExpression = { leaf: { minRisk: 50 } };
    const untrusted: PolicyExpression = { leaf: { requireDeviceTrust: true } };
    expect(evaluator.evaluate(highRisk, ctx({ risk: 60 }))).toBe(true);
    expect(
      evaluator.evaluate({ allOf: [highRisk, untrusted] }, ctx({ risk: 60, deviceTrusted: false })),
    ).toBe(true);
    expect(
      evaluator.evaluate({ allOf: [highRisk, untrusted] }, ctx({ risk: 60, deviceTrusted: true })),
    ).toBe(false);
    expect(
      evaluator.evaluate({ anyOf: [highRisk, untrusted] }, ctx({ risk: 10, deviceTrusted: false })),
    ).toBe(true);
    expect(evaluator.evaluate({ not: highRisk }, ctx({ risk: 10 }))).toBe(true);
  });

  it("resolves reusable fragments", () => {
    const resolver: FragmentResolver = {
      resolve: (key) =>
        key === "risky"
          ? { anyOf: [{ leaf: { minRisk: 50 } }, { leaf: { requireDeviceTrust: true } }] }
          : null,
    };
    expect(evaluator.evaluate({ fragment: "risky" }, ctx({ risk: 80 }), resolver)).toBe(true);
    expect(
      evaluator.evaluate({ fragment: "risky" }, ctx({ risk: 10, deviceTrusted: true }), resolver),
    ).toBe(false);
    expect(evaluator.evaluate({ fragment: "unknown" }, ctx(), resolver)).toBe(false);
  });

  it("is cycle-safe on self-referential fragments", () => {
    const resolver: FragmentResolver = {
      resolve: (key) => (key === "loop" ? { fragment: "loop" } : null),
    };
    expect(evaluator.evaluate({ fragment: "loop" }, ctx(), resolver)).toBe(false);
  });
});
