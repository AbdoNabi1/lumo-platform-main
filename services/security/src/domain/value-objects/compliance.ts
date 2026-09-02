import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

/** Data sensitivity classification (DLP / access decisions key off this) — sprint Part 6. */
export const DATA_CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

/** Lawful basis for processing (GDPR Art. 6). First-class so consent is never the only basis. */
export const LEGAL_BASES = [
  "consent",
  "contract",
  "legal_obligation",
  "vital_interests",
  "public_task",
  "legitimate_interests",
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

/** Compliance frameworks the platform's posture maps to (read-model + control tagging). */
export const COMPLIANCE_FRAMEWORKS = ["gdpr", "soc2", "iso27001", "hipaa", "pci_dss"] as const;
export type ComplianceFramework = (typeof COMPLIANCE_FRAMEWORKS)[number];

export interface RetentionPolicyProps {
  readonly retainDays: number;
  readonly legalBasis: LegalBasis;
  readonly classification: DataClassification;
}

/**
 * A **retention policy** primitive — how long a class of data is kept and under what lawful basis
 * (GDPR/SOC2/ISO27001). Immutable value object; the durable enforcement (right-to-delete/export
 * jobs) composes on top later without changing this contract (ADR-0023, sprint Part 6).
 */
export class RetentionPolicy extends ValueObject<RetentionPolicyProps> {
  private constructor(props: RetentionPolicyProps) {
    super(props);
  }

  static create(props: RetentionPolicyProps): Result<RetentionPolicy, ValidationError> {
    if (!Number.isInteger(props.retainDays) || props.retainDays < 0) {
      return err(
        new ValidationError("retention is invalid", [
          { field: "retainDays", message: "must be a non-negative integer" },
        ]),
      );
    }
    return ok(new RetentionPolicy({ ...props }));
  }

  get retainDays(): number {
    return this.props.retainDays;
  }
  get legalBasis(): LegalBasis {
    return this.props.legalBasis;
  }
  get classification(): DataClassification {
    return this.props.classification;
  }
}
