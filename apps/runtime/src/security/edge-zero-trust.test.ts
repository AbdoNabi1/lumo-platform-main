import { describe, expect, it } from "vitest";
import type {
  AccessDecisionOutput,
  EvaluateAccessInput,
  ThreatIntelResolver,
  ThreatVerdict,
} from "@platform/security";
import { EdgeCache } from "./edge-cache";
import {
  EdgeZeroTrustEvaluator,
  fingerprintRequest,
  type ZeroTrustDecider,
} from "./edge-zero-trust";
import type { SecurityInstrumentation } from "./security-instrumentation";

/** A stub instrumentation that just runs the operation (span/metrics are covered in their own tests). */
const stubInstrumentation = {
  authorization: (_ctx: unknown, fn: (span: unknown) => Promise<unknown>) => fn(undefined),
} as SecurityInstrumentation;
const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
} as never;

function decision(overrides: Partial<AccessDecisionOutput>): AccessDecisionOutput {
  return {
    effect: "allow",
    allowed: true,
    reasons: [],
    matchedRuleIds: [],
    policyKey: null,
    policyVersion: null,
    risk: 0,
    trust: 0,
    roleKeys: [],
    auditId: "a-1",
    ...overrides,
  };
}

class CapturingDecider implements ZeroTrustDecider {
  lastInput: EvaluateAccessInput | undefined;
  constructor(private readonly result: AccessDecisionOutput) {}
  async authorize(input: EvaluateAccessInput): Promise<AccessDecisionOutput> {
    this.lastInput = input;
    return this.result;
  }
}

class CountingThreat implements ThreatIntelResolver {
  calls = 0;
  constructor(private readonly verdict: ThreatVerdict) {}
  providerNames(): readonly string[] {
    return ["feed"];
  }
  async lookupAll(indicator: string): Promise<readonly ThreatVerdict[]> {
    this.calls += 1;
    return [{ ...this.verdict, indicator }];
  }
}

describe("fingerprintRequest", () => {
  it("produces a stable, non-reversible fingerprint carrying geo/device", () => {
    const a = fingerprintRequest({
      ip: "1.2.3.4",
      userAgent: "UA",
      deviceRef: "d1",
      country: "DE",
    });
    const b = fingerprintRequest({
      ip: "1.2.3.4",
      userAgent: "UA",
      deviceRef: "d1",
      country: "DE",
    });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toContain("1.2.3.4");
    expect(a.country).toBe("DE");
  });
});

describe("EdgeZeroTrustEvaluator", () => {
  it("maps an allow decision to HTTP 200", async () => {
    const evaluator = new EdgeZeroTrustEvaluator({
      decider: new CapturingDecider(decision({ effect: "allow", allowed: true })),
      instrumentation: stubInstrumentation,
      logger: silent,
    });
    const result = await evaluator.evaluate({ principalId: "p-1", permission: "orders:read" });
    expect(result).toMatchObject({ effect: "allow", allowed: true, status: 200 });
  });

  it("maps a deny to 403 and a challenge to 401", async () => {
    const deny = new EdgeZeroTrustEvaluator({
      decider: new CapturingDecider(
        decision({ effect: "block", allowed: false, reasons: ["no-permission"] }),
      ),
      instrumentation: stubInstrumentation,
      logger: silent,
    });
    expect(await deny.evaluate({ principalId: "p", permission: "x:y" })).toMatchObject({
      effect: "deny",
      status: 403,
      reasons: ["no-permission"],
    });

    const challenge = new EdgeZeroTrustEvaluator({
      decider: new CapturingDecider(decision({ effect: "challenge", allowed: false })),
      instrumentation: stubInstrumentation,
      logger: silent,
    });
    expect(await challenge.evaluate({ principalId: "p", permission: "x:y" })).toMatchObject({
      effect: "challenge",
      status: 401,
    });
  });

  it("feeds aggregated threat-intel reputation into the decision's risk signals", async () => {
    const decider = new CapturingDecider(decision({ allowed: true }));
    const threat = new CountingThreat({
      indicator: "1.2.3.4",
      malicious: true,
      score: 88,
      categories: ["c2"],
      source: "feed",
    });
    const evaluator = new EdgeZeroTrustEvaluator({
      decider,
      instrumentation: stubInstrumentation,
      logger: silent,
      threat,
    });
    await evaluator.evaluate({ principalId: "p", permission: "x:y", ip: "1.2.3.4" });
    expect(decider.lastInput?.risk).toMatchObject({ threatIntelHit: true, ipReputation: 88 });
  });

  it("caches threat lookups per IP", async () => {
    const decider = new CapturingDecider(decision({ allowed: true }));
    const threat = new CountingThreat({
      indicator: "1.2.3.4",
      malicious: false,
      score: 0,
      categories: [],
      source: "feed",
    });
    const cache = new EdgeCache({ now: () => 0 });
    const evaluator = new EdgeZeroTrustEvaluator({
      decider,
      instrumentation: stubInstrumentation,
      logger: silent,
      threat,
      cache,
    });
    await evaluator.evaluate({ principalId: "p", permission: "x:y", ip: "1.2.3.4" });
    await evaluator.evaluate({ principalId: "p", permission: "x:y", ip: "1.2.3.4" });
    expect(threat.calls).toBe(1);
  });
});
