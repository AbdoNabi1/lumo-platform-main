import type { UseCase } from "@platform/application";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { SecurityDeps } from "./deps";

export interface CheckConsentInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  /** The Identity subject id (the human principal's `subjectRef`). */
  readonly subjectRef: string;
  /** The consent scope/purpose being checked (Identity's `ConsentScope`). */
  readonly purpose: string;
}

export interface ConsentDecision {
  readonly subjectRef: string;
  readonly purpose: string;
  readonly granted: boolean;
}

/**
 * Reads the latest projected consent decision for a subject/purpose (H-2 / G-SEC-4). This is Security's
 * sanctioned way to consult consent for a compliance/data-handling decision without re-owning it:
 * Identity owns and emits consent; the {@link ConsentPort} answers from the projection the
 * {@link ConsentChangedConsumer} keeps current. Absent projection ⇒ not granted (fail-closed). A pure
 * read — no mutation, no audit anchor.
 */
export class CheckConsent implements UseCase<CheckConsentInput, ConsentDecision, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}

  async execute(input: CheckConsentInput): Promise<Result<ConsentDecision, DomainError>> {
    const granted = await this.deps.consent.hasConsent(
      input.subjectRef,
      input.purpose,
      input.tenantId,
    );
    return ok({ subjectRef: input.subjectRef, purpose: input.purpose, granted });
  }
}
