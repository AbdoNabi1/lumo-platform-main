import { describe, expect, it } from "vitest";
import { PolicyVersion, type PolicyRule } from "./policy";
import { ResourceUrn } from "./value-objects/resource-urn";
import { ZeroTrustEvaluator, type ZeroTrustContext } from "./zero-trust";

const base: ZeroTrustContext = {
  principalActive: true,
  sessionValid: true,
  permissionGranted: true,
  deviceTrusted: true,
  risk: 0,
  trust: 100,
  environment: "production",
  resource: null,
};

function version(
  rules: readonly PolicyRule[],
  defaultEffect: "allow" | "challenge" | "block" | "review" = "allow",
): PolicyVersion {
  return new PolicyVersion({
    version: 1,
    rules,
    defaultEffect,
    publishedAt: new Date("2026-07-17T00:00:00.000Z"),
  });
}

describe("ZeroTrustEvaluator", () => {
  const evaluator = new ZeroTrustEvaluator();

  it("fails closed on structural gates (no implicit trust)", () => {
    expect(evaluator.evaluate({ ...base, principalActive: false }, null).effect).toBe("block");
    expect(evaluator.evaluate({ ...base, sessionValid: false }, null).effect).toBe("block");
    expect(evaluator.evaluate({ ...base, permissionGranted: false }, null).effect).toBe("block");
  });

  it("allows when gates pass and no policy is configured", () => {
    const decision = evaluator.evaluate(base, null);
    expect(decision.effect).toBe("allow");
    expect(decision.policyVersion).toBeNull();
  });

  it("fires a risk rule and explains the decision", () => {
    const rule: PolicyRule = {
      id: "high-risk",
      description: "block high risk",
      when: { minRisk: 50 },
      effect: "block",
    };
    expect(evaluator.evaluate({ ...base, risk: 60 }, version([rule])).effect).toBe("block");
    const low = evaluator.evaluate({ ...base, risk: 10 }, version([rule]));
    expect(low.effect).toBe("allow");
    expect(low.matchedRuleIds).toEqual([]);
  });

  it("applies deny-overrides precedence across fired rules", () => {
    const rules: PolicyRule[] = [
      {
        id: "challenge-untrusted",
        description: "challenge untrusted device",
        when: { requireDeviceTrust: true },
        effect: "challenge",
      },
      { id: "block-risky", description: "block risky", when: { minRisk: 80 }, effect: "block" },
    ];
    expect(
      evaluator.evaluate({ ...base, deviceTrusted: false, risk: 90 }, version(rules)).effect,
    ).toBe("block");
    expect(
      evaluator.evaluate({ ...base, deviceTrusted: false, risk: 10 }, version(rules)).effect,
    ).toBe("challenge");
  });

  it("scopes a rule to a resource pattern and environment", () => {
    const rule: PolicyRule = {
      id: "prod-finance",
      description: "review finance in prod",
      when: { environments: ["production"], resource: "morbeh:finance:*:*" },
      effect: "review",
    };
    const financeCtx = { ...base, resource: parse("morbeh:finance:ledger:l1") };
    const catalogCtx = { ...base, resource: parse("morbeh:catalog:product:p1") };
    expect(evaluator.evaluate(financeCtx, version([rule])).effect).toBe("review");
    expect(evaluator.evaluate(catalogCtx, version([rule])).effect).toBe("allow");
  });
});

function parse(urn: string): ResourceUrn {
  const r = ResourceUrn.parse(urn);
  if (!r.ok) throw new Error(urn);
  return r.value;
}
