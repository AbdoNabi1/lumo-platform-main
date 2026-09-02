import { describe, expect, it } from "vitest";
import { MfaEngine, type MfaDecisionContext } from "./mfa-engine";

const base: MfaDecisionContext = {
  tenantMfaRequired: false,
  hasActiveEnrollment: true,
  deviceTrusted: false,
  rememberDevice: false,
  riskBand: "low",
  sensitiveAction: false,
};

describe("MfaEngine", () => {
  const engine = new MfaEngine();

  it("skips MFA on a trusted, remembered device at low risk", () => {
    expect(engine.decide({ ...base, deviceTrusted: true, rememberDevice: true }).requirement).toBe(
      "none",
    );
  });

  it("requires MFA when tenant policy demands it", () => {
    expect(engine.decide({ ...base, tenantMfaRequired: true }).requirement).toBe("required");
  });

  it("steps up on elevated/high risk (adaptive)", () => {
    expect(engine.decide({ ...base, riskBand: "elevated" }).requirement).toBe("step_up");
    expect(engine.decide({ ...base, riskBand: "high" }).requirement).toBe("step_up");
  });

  it("steps up for a sensitive action even on a trusted device", () => {
    expect(
      engine.decide({ ...base, deviceTrusted: true, rememberDevice: true, sensitiveAction: true })
        .requirement,
    ).toBe("step_up");
  });

  it("falls back to enrollment when a factor is demanded but none is enrolled", () => {
    const decision = engine.decide({ ...base, hasActiveEnrollment: false, riskBand: "high" });
    expect(decision.requirement).toBe("required");
    expect(decision.reasons.some((r) => r.includes("no active enrollment"))).toBe(true);
  });

  it("defaults to optional when nothing forces MFA", () => {
    expect(engine.decide(base).requirement).toBe("optional");
  });
});
