import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, BusinessRuleError, NotFoundError } from "@platform/utils";
import { MfaEnrollment } from "../domain/mfa-enrollment";
import type { MfaDecision } from "../domain/mfa-engine";
import type { MfaMethodKind } from "../domain/value-objects/auth-method";
import type { RiskBand } from "../domain/value-objects/scores";
import { recordAudit, type SecurityDeps } from "./deps";

export interface MfaEnrollmentOutput {
  readonly id: string;
  readonly principalRef: string;
  readonly method: string;
  readonly status: string;
  readonly remainingBackupCodes: number;
  /** Present only on the `EnrollMfa` response that created this enrollment — see {@link MfaProviderPort.enroll}. */
  readonly provisioningUri?: string;
}

function present(e: MfaEnrollment, provisioningUri?: string): MfaEnrollmentOutput {
  return {
    id: e.id.toString(),
    principalRef: e.principalRef,
    method: e.method,
    status: e.status,
    remainingBackupCodes: e.remainingBackupCodes,
    ...(provisioningUri !== undefined ? { provisioningUri } : {}),
  };
}

export interface EnrollMfaInput {
  readonly principalExternalId: string;
  readonly method: MfaMethodKind;
}

/** Enrolls a principal in an MFA method via the provider plugin (secret is referenced, never stored). */
export class EnrollMfa implements UseCase<EnrollMfaInput, MfaEnrollmentOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: EnrollMfaInput): Promise<Result<MfaEnrollmentOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(input.principalExternalId);
    if (principal === null) return err(new NotFoundError("Principal not found"));
    const provider = this.deps.mfaProviders.get(input.method);
    if (provider === null)
      return err(new BusinessRuleError(`No MFA provider registered for "${input.method}"`));
    const registered = this.deps.mfaMethodRegistry.get(input.method);
    if (registered !== null && !registered.value.enabled)
      return err(new BusinessRuleError(`MFA method "${input.method}" is disabled`));
    const { secretRef, provisioningUri } = await provider.enroll({
      principalRef: principal.id.toString(),
    });
    return this.deps.unitOfWork.run<Result<MfaEnrollmentOutput, DomainError>>(async (tx) => {
      const enrollment = MfaEnrollment.enroll(
        UniqueEntityId.from(this.deps.idGenerator.generate()),
        { principalRef: principal.id.toString(), method: input.method, secretRef },
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
      );
      await this.deps.mfaEnrollments.save(enrollment, tx);
      await recordAudit(this.deps, tx, {
        principalRef: principal.externalId,
        action: "security.mfa.enrolled",
        decision: "allow",
        tenantRef: principal.tenantRef,
        metadata: { method: input.method },
      });
      return ok(present(enrollment, provisioningUri));
    });
  }
}

export interface VerifyMfaInput {
  readonly enrollmentId: string;
  readonly code: string;
}

/** Verifies a submitted MFA code via the provider; activates a pending enrollment. Emits `security.mfa.verified`. */
export class VerifyMfaEnrollment implements UseCase<
  VerifyMfaInput,
  MfaEnrollmentOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: VerifyMfaInput): Promise<Result<MfaEnrollmentOutput, DomainError>> {
    const enrollment = await this.deps.mfaEnrollments.findById(input.enrollmentId);
    if (enrollment === null) return err(new NotFoundError("MFA enrollment not found"));
    const provider = this.deps.mfaProviders.get(enrollment.method);
    if (provider === null)
      return err(new BusinessRuleError(`No MFA provider registered for "${enrollment.method}"`));
    const verified = await provider.verify({ secretRef: enrollment.secretRef, code: input.code });
    if (!verified) {
      this.deps.telemetry.increment("security.mfa.failed");
      return err(new BusinessRuleError("MFA verification failed"));
    }
    return this.deps.unitOfWork.run<Result<MfaEnrollmentOutput, DomainError>>(async (tx) => {
      try {
        enrollment.markVerified(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.mfaEnrollments.save(enrollment, tx);
      this.deps.telemetry.increment("security.mfa.succeeded");
      await recordAudit(this.deps, tx, {
        principalRef: enrollment.principalRef,
        action: "security.mfa.verified",
        decision: "allow",
        metadata: { method: enrollment.method },
      });
      return ok(present(enrollment));
    });
  }
}

export interface GenerateBackupCodesInput {
  readonly enrollmentId: string;
  readonly count?: number;
}

export interface BackupCodesOutput {
  readonly codes: readonly string[];
}

/**
 * Generates one-time backup codes: only their non-reversible hashes are stored ({@link CryptoPort}),
 * the plaintext is returned **once** to the caller. Replaces any existing codes.
 */
export class GenerateBackupCodes implements UseCase<
  GenerateBackupCodesInput,
  BackupCodesOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: GenerateBackupCodesInput): Promise<Result<BackupCodesOutput, DomainError>> {
    const enrollment = await this.deps.mfaEnrollments.findById(input.enrollmentId);
    if (enrollment === null) return err(new NotFoundError("MFA enrollment not found"));
    const count = input.count ?? 10;
    const codes: string[] = [];
    const hashes: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const code = await this.deps.crypto.randomToken(6);
      codes.push(code);
      hashes.push(await this.deps.crypto.hash(code));
    }
    return this.deps.unitOfWork.run<Result<BackupCodesOutput, DomainError>>(async (tx) => {
      enrollment.setBackupCodes(hashes);
      await this.deps.mfaEnrollments.save(enrollment, tx);
      await recordAudit(this.deps, tx, {
        principalRef: enrollment.principalRef,
        action: "security.mfa.backup_codes_generated",
        decision: "allow",
        metadata: { count: String(count) },
      });
      return ok({ codes });
    });
  }
}

export interface RevokeMfaInput {
  readonly enrollmentId: string;
}

/** Revokes an MFA enrollment. Emits `security.mfa.revoked` + audit. */
export class RevokeMfa implements UseCase<RevokeMfaInput, MfaEnrollmentOutput, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RevokeMfaInput): Promise<Result<MfaEnrollmentOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<MfaEnrollmentOutput, DomainError>>(async (tx) => {
      const enrollment = await this.deps.mfaEnrollments.findById(input.enrollmentId, tx);
      if (enrollment === null) return err(new NotFoundError("MFA enrollment not found"));
      enrollment.revoke(this.deps.idGenerator.generate(), this.deps.clock.now());
      await this.deps.mfaEnrollments.save(enrollment, tx);
      await recordAudit(this.deps, tx, {
        principalRef: enrollment.principalRef,
        action: "security.mfa.revoked",
        decision: "allow",
        metadata: { method: enrollment.method },
      });
      return ok(present(enrollment));
    });
  }
}

export interface DecideMfaInput {
  readonly principalExternalId: string;
  readonly deviceFingerprint?: string;
  readonly riskBand: RiskBand;
  readonly sensitiveAction?: boolean;
  readonly rememberDevice?: boolean;
}

/** Decides the MFA requirement for a request via the {@link MfaEngine} (read-only, no mutation). */
export class DecideMfa implements UseCase<DecideMfaInput, MfaDecision, DomainError> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: DecideMfaInput): Promise<Result<MfaDecision, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(input.principalExternalId);
    if (principal === null) return err(new NotFoundError("Principal not found"));
    const profile =
      principal.tenantRef !== null
        ? await this.deps.tenantProfiles.findByTenant(principal.tenantRef)
        : null;
    const enrollments = await this.deps.mfaEnrollments.listByPrincipal(principal.id.toString());
    const hasActiveEnrollment = enrollments.some((e) => e.isActive);
    let deviceTrusted = false;
    if (input.deviceFingerprint !== undefined) {
      const device = await this.deps.devices.findByFingerprint(input.deviceFingerprint);
      deviceTrusted = device !== null && device.isTrusted;
    }
    const decision = this.deps.mfaEngine.decide({
      tenantMfaRequired: profile?.mfaRequired ?? false,
      hasActiveEnrollment,
      deviceTrusted,
      rememberDevice: input.rememberDevice ?? false,
      riskBand: input.riskBand,
      sensitiveAction: input.sensitiveAction ?? false,
    });
    return ok(decision);
  }
}
