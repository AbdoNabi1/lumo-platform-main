import type {
  ComplianceControl,
  ComplianceEvaluationContext,
  ComplianceFinding,
  ComplianceRulePack,
  ControlSeverity,
} from "../domain/compliance-engine";
import type { ComplianceFramework } from "../domain/value-objects/compliance";
import type { ComplianceRulePackResolver } from "../application/compliance-ports";

interface ControlDef {
  readonly id: string;
  readonly description: string;
  readonly severity: ControlSeverity;
  readonly satisfied: (c: ComplianceEvaluationContext) => boolean;
}

/**
 * A declarative rule pack — a framework plus its controls, each with a predicate over the evaluation
 * context. Concrete packs (GDPR/SOC2/…) are instances; this keeps every pack a small, real, testable
 * mapping (no framework logic in the engine). Providers for external GRC tools implement the same
 * `ComplianceRulePack` interface later.
 */
class DeclarativeRulePack implements ComplianceRulePack {
  readonly controls: readonly ComplianceControl[];
  constructor(
    readonly framework: ComplianceFramework,
    private readonly defs: readonly ControlDef[],
  ) {
    this.controls = defs.map((d) => ({
      id: d.id,
      framework,
      description: d.description,
      severity: d.severity,
    }));
  }
  evaluate(context: ComplianceEvaluationContext): readonly ComplianceFinding[] {
    return this.defs.map((d): ComplianceFinding => {
      const control: ComplianceControl = {
        id: d.id,
        framework: this.framework,
        description: d.description,
        severity: d.severity,
      };
      const ok = d.satisfied(context);
      return {
        control,
        status: ok ? "pass" : "fail",
        detail: ok ? "satisfied" : "control not met",
      };
    });
  }
}

const soc2 = new DeclarativeRulePack("soc2", [
  {
    id: "CC6.1",
    description: "MFA enforced for access",
    severity: "high",
    satisfied: (c) => c.mfaRequired,
  },
  {
    id: "CC7.2",
    description: "Tamper-evident audit trail",
    severity: "critical",
    satisfied: (c) => c.auditChainValid,
  },
  {
    id: "CC6.7",
    description: "Encryption at rest",
    severity: "high",
    satisfied: (c) => c.encryptionAtRest,
  },
]);

const gdpr = new DeclarativeRulePack("gdpr", [
  {
    id: "ART5",
    description: "Storage limitation / retention defined",
    severity: "high",
    satisfied: (c) => c.retentionDefined,
  },
  {
    id: "ART7",
    description: "Consent recorded",
    severity: "high",
    satisfied: (c) => c.consentTracked,
  },
  {
    id: "ART32",
    description: "Encryption of personal data",
    severity: "high",
    satisfied: (c) => c.encryptionAtRest,
  },
]);

const iso27001 = new DeclarativeRulePack("iso27001", [
  {
    id: "A.9.4",
    description: "Secure log-on (MFA)",
    severity: "high",
    satisfied: (c) => c.mfaRequired,
  },
  {
    id: "A.12.4",
    description: "Logging and monitoring",
    severity: "critical",
    satisfied: (c) => c.auditChainValid,
  },
  {
    id: "A.10.1",
    description: "Cryptographic controls",
    severity: "high",
    satisfied: (c) => c.encryptionAtRest,
  },
]);

const hipaa = new DeclarativeRulePack("hipaa", [
  {
    id: "164.312(a)",
    description: "Access control (MFA)",
    severity: "high",
    satisfied: (c) => c.mfaRequired,
  },
  {
    id: "164.312(b)",
    description: "Audit controls",
    severity: "critical",
    satisfied: (c) => c.auditChainValid,
  },
  {
    id: "164.312(e)",
    description: "Transmission/at-rest encryption",
    severity: "high",
    satisfied: (c) => c.encryptionAtRest,
  },
]);

const pciDss = new DeclarativeRulePack("pci_dss", [
  {
    id: "8.3",
    description: "Multi-factor authentication",
    severity: "high",
    satisfied: (c) => c.mfaRequired,
  },
  {
    id: "10.2",
    description: "Audit trails",
    severity: "critical",
    satisfied: (c) => c.auditChainValid,
  },
  {
    id: "3.4",
    description: "Render PAN unreadable (encryption)",
    severity: "critical",
    satisfied: (c) => c.encryptionAtRest,
  },
]);

/** Map-backed {@link ComplianceRulePackResolver} seeded with the built-in reference packs. */
export class DefaultComplianceRulePackResolver implements ComplianceRulePackResolver {
  private readonly byFramework = new Map<ComplianceFramework, ComplianceRulePack>();
  constructor(packs: readonly ComplianceRulePack[] = [soc2, gdpr, iso27001, hipaa, pciDss]) {
    for (const pack of packs) this.byFramework.set(pack.framework, pack);
  }
  register(pack: ComplianceRulePack): void {
    this.byFramework.set(pack.framework, pack);
  }
  get(framework: ComplianceFramework): ComplianceRulePack | null {
    return this.byFramework.get(framework) ?? null;
  }
  frameworks(): readonly ComplianceFramework[] {
    return [...this.byFramework.keys()];
  }
}
