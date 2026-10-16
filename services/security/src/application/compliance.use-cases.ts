import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { ComplianceReport, FindingStatus } from "../domain/compliance-engine";
import type { ComplianceFramework } from "../domain/value-objects/compliance";
import { recordAudit, securityEvent, type SecurityDeps } from "./deps";

export interface EvaluateComplianceInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly framework: ComplianceFramework;
  readonly tenantRef?: string | null;
  /** Caller attestations (with evidence) for signals not derivable from platform state. */
  readonly attestations?: {
    readonly encryptionAtRest?: boolean;
    readonly consentTracked?: boolean;
    readonly retentionDefined?: boolean;
  };
}

export interface ComplianceReportOutput {
  readonly framework: string;
  readonly compliant: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly notApplicable: number;
  readonly findings: readonly {
    readonly controlId: string;
    readonly status: FindingStatus;
    readonly severity: string;
    readonly detail: string;
  }[];
}

function present(report: ComplianceReport): ComplianceReportOutput {
  return {
    framework: report.framework,
    compliant: report.compliant,
    passed: report.passed,
    failed: report.failed,
    notApplicable: report.notApplicable,
    findings: report.findings.map((f) => ({
      controlId: f.control.id,
      status: f.status,
      severity: f.control.severity,
      detail: f.detail,
    })),
  };
}

/**
 * Evaluates a tenant's posture against a compliance framework's pluggable rule pack (sprint P2.0-D §9).
 * Platform-derived signals (audit-chain validity via {@link AuditChain}, MFA enforcement via the tenant
 * profile) are filled from **live state**; the remaining signals are caller attestations. Emits
 * `security.compliance.evaluated` and a WORM audit record.
 */
export class EvaluateCompliance implements UseCase<
  EvaluateComplianceInput,
  ComplianceReportOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: EvaluateComplianceInput,
  ): Promise<Result<ComplianceReportOutput, DomainError>> {
    const pack = this.deps.complianceRulePacks.get(input.framework);
    if (pack === null)
      return err(new NotFoundError(`No compliance rule pack registered for "${input.framework}"`));

    const tenantRef = input.tenantRef ?? null;
    const profile =
      tenantRef !== null
        ? await this.deps.tenantProfiles.findByTenant(tenantRef, input.tenantId)
        : null;
    const auditRecords = await this.deps.auditLedger.list(tenantRef, input.tenantId);
    const auditChainValid = this.deps.auditChain.verify(auditRecords).valid;
    const attest = input.attestations ?? {};

    const report = this.deps.complianceEngine.evaluate(pack, {
      mfaRequired: profile?.mfaRequired ?? false,
      auditChainValid,
      retentionDefined: attest.retentionDefined ?? false,
      encryptionAtRest: attest.encryptionAtRest ?? false,
      consentTracked: attest.consentTracked ?? false,
    });

    return this.deps.unitOfWork.run<Result<ComplianceReportOutput, DomainError>>(async (tx) => {
      await this.deps.outbox.publish(
        [
          securityEvent(
            this.deps,
            "compliance",
            this.deps.idGenerator.generate(),
            input.framework,
            "security.compliance.evaluated",
            report.compliant ? "compliant" : "non_compliant",
          ),
        ],
        input.tenantId,
        tx,
      );
      await recordAudit(this.deps, tx, {
        tenantId: input.tenantId,
        principalRef: "system",
        action: "security.compliance.evaluated",
        decision: report.compliant ? "allow" : "deny",
        tenantRef,
        metadata: { framework: input.framework, failed: String(report.failed) },
      });
      return ok(present(report));
    });
  }
}
