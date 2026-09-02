import type { ComplianceFramework } from "./value-objects/compliance";

export type ControlSeverity = "low" | "medium" | "high" | "critical";

/** A single compliance control (e.g. SOC2 CC6.1) — registered + versioned in the Registry Engine. */
export interface ComplianceControl {
  readonly id: string;
  readonly framework: ComplianceFramework;
  readonly description: string;
  readonly severity: ControlSeverity;
}

export type FindingStatus = "pass" | "fail" | "not_applicable";

export interface ComplianceFinding {
  readonly control: ComplianceControl;
  readonly status: FindingStatus;
  readonly detail: string;
}

/**
 * The real security state a compliance evaluation runs against (sprint P2.0-D §9). Platform-derived
 * signals (audit-chain validity, MFA enforcement) are filled by the application from live state;
 * attestations (encryption-at-rest, consent tracking, retention defined) are supplied by the caller
 * with evidence — the standard mix auditors accept.
 */
export interface ComplianceEvaluationContext {
  readonly mfaRequired: boolean;
  readonly auditChainValid: boolean;
  readonly retentionDefined: boolean;
  readonly encryptionAtRest: boolean;
  readonly consentTracked: boolean;
}

/**
 * A **compliance rule pack** (sprint P2.0-D §9) — a pluggable framework implementation (GDPR / SOC2 /
 * ISO27001 / HIPAA / PCI DSS). Each pack maps its controls onto {@link ComplianceEvaluationContext}
 * and returns findings. Packs are plugins behind a resolver — new frameworks add without redesign.
 */
export interface ComplianceRulePack {
  readonly framework: ComplianceFramework;
  readonly controls: readonly ComplianceControl[];
  evaluate(context: ComplianceEvaluationContext): readonly ComplianceFinding[];
}

export interface ComplianceReport {
  readonly framework: ComplianceFramework;
  readonly compliant: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly notApplicable: number;
  readonly findings: readonly ComplianceFinding[];
}

/**
 * The **Compliance Engine** — runs a framework's rule pack over the evaluation context and rolls the
 * findings into a report (`compliant` iff zero failures). Deterministic and explainable; the packs do
 * the framework-specific evaluation. The engine owns no framework knowledge — packs are pluggable.
 */
export class ComplianceEngine {
  evaluate(pack: ComplianceRulePack, context: ComplianceEvaluationContext): ComplianceReport {
    const findings = pack.evaluate(context);
    const passed = findings.filter((f) => f.status === "pass").length;
    const failed = findings.filter((f) => f.status === "fail").length;
    const notApplicable = findings.filter((f) => f.status === "not_applicable").length;
    return {
      framework: pack.framework,
      compliant: failed === 0,
      passed,
      failed,
      notApplicable,
      findings,
    };
  }
}
