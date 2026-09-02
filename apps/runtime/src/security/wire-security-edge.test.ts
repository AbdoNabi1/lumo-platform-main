import { describe, expect, it } from "vitest";
import type { Logger } from "@platform/utils";
import type { AccessDecisionOutput, EvaluateAccessInput } from "@platform/security";
import { EdgeZeroTrustEvaluator } from "./edge-zero-trust";
import { SecurityPermissionGuard } from "./edge-middleware";
import { OtelSecurityTelemetry } from "./security-telemetry-otel";
import { SecurityInstrumentation } from "./security-instrumentation";
import { EdgeCache } from "./edge-cache";
import { wireSecurityEdge } from "./wire-security-edge";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};
const decider = {
  authorize: async (_i: EvaluateAccessInput): Promise<AccessDecisionOutput> => ({
    effect: "allow",
    allowed: true,
    reasons: [],
    matchedRuleIds: [],
    policyKey: null,
    policyVersion: null,
    risk: 0,
    trust: 0,
    roleKeys: [],
    auditId: "a",
  }),
};

describe("wireSecurityEdge (H-4 composition)", () => {
  it("builds the decider-agnostic observability + cache at boot", () => {
    const wired = wireSecurityEdge({ logger: silent });
    expect(wired.telemetry).toBeInstanceOf(OtelSecurityTelemetry);
    expect(wired.instrumentation).toBeInstanceOf(SecurityInstrumentation);
    expect(wired.edgeCache).toBeInstanceOf(EdgeCache);
  });

  it("produces the evaluator + @platform/http guard when the decision surface binds", () => {
    const wired = wireSecurityEdge({ logger: silent });
    expect(wired.buildEvaluator(decider)).toBeInstanceOf(EdgeZeroTrustEvaluator);
    expect(wired.buildGuard(decider)).toBeInstanceOf(SecurityPermissionGuard);
  });
});
