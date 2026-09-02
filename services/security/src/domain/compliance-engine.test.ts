import { describe, expect, it } from "vitest";
import { ComplianceEngine, type ComplianceEvaluationContext } from "./compliance-engine";
import { DefaultComplianceRulePackResolver } from "../infrastructure/compliance-packs";

const resolver = new DefaultComplianceRulePackResolver();
const engine = new ComplianceEngine();

function pack(framework: "soc2" | "gdpr") {
  const p = resolver.get(framework);
  if (p === null) throw new Error(framework);
  return p;
}

describe("ComplianceEngine (§9)", () => {
  it("reports compliant when every control passes", () => {
    const context: ComplianceEvaluationContext = {
      mfaRequired: true,
      auditChainValid: true,
      retentionDefined: true,
      encryptionAtRest: true,
      consentTracked: true,
    };
    const report = engine.evaluate(pack("soc2"), context);
    expect(report.compliant).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(report.findings.length);
  });

  it("fails and explains when a control is unmet", () => {
    const context: ComplianceEvaluationContext = {
      mfaRequired: false,
      auditChainValid: true,
      retentionDefined: true,
      encryptionAtRest: true,
      consentTracked: true,
    };
    const report = engine.evaluate(pack("soc2"), context);
    expect(report.compliant).toBe(false);
    expect(report.findings.some((f) => f.control.id === "CC6.1" && f.status === "fail")).toBe(true);
  });

  it("evaluates a different framework's controls", () => {
    const context: ComplianceEvaluationContext = {
      mfaRequired: true,
      auditChainValid: true,
      retentionDefined: false,
      encryptionAtRest: true,
      consentTracked: true,
    };
    const report = engine.evaluate(pack("gdpr"), context);
    expect(report.framework).toBe("gdpr");
    expect(report.findings.some((f) => f.control.id === "ART5" && f.status === "fail")).toBe(true); // retention not defined
  });
});
