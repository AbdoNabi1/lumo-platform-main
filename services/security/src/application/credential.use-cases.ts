import type { UseCase } from "@platform/application";
import { isDomainError, UniqueEntityId } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, BusinessRuleError, NotFoundError } from "@platform/utils";
import { Credential, type CredentialKind } from "../domain/credential";
import { RotationPolicy } from "../domain/value-objects/rotation-policy";
import { recordAudit, type SecurityDeps } from "./deps";

export interface CredentialOutput {
  readonly id: string;
  readonly principalRef: string;
  readonly kind: string;
  readonly status: string;
  readonly kmsKeyRef: string | null;
  readonly supersedesRef: string | null;
  readonly expiresAt: string | null;
  readonly rotationDueAt: string | null;
  readonly autoRotate: boolean;
}

function present(c: Credential): CredentialOutput {
  return {
    id: c.id.toString(),
    principalRef: c.principalRef,
    kind: c.kind,
    status: c.status,
    kmsKeyRef: c.kmsKeyRef,
    supersedesRef: c.supersedesRef,
    expiresAt: c.expiresAt === null ? null : c.expiresAt.toISOString(),
    rotationDueAt: c.rotationDueAt === null ? null : c.rotationDueAt.toISOString(),
    autoRotate: c.autoRotate,
  };
}

export interface IssueCredentialInput {
  readonly principalExternalId: string;
  readonly kind: CredentialKind;
  /** A handle to the secret material (never persisted) — a KMS key ref + fingerprint are derived. */
  readonly material: string;
  readonly expiresAt?: string | null;
}

/**
 * Issues a credential for a principal. The raw `material` is turned into a {@link KmsPort} key
 * reference + a non-reversible fingerprint — the value itself never enters the domain or storage.
 * Emits `security.credential.issued` + audit.
 */
export class IssueCredential implements UseCase<
  IssueCredentialInput,
  CredentialOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: IssueCredentialInput): Promise<Result<CredentialOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(input.principalExternalId);
    if (principal === null) return err(new NotFoundError("Principal not found"));
    const kmsKeyRef = await this.deps.kms.generateKeyRef(`credential:${input.kind}`);
    const fingerprint = await this.deps.kms.fingerprint(input.material);
    return this.deps.unitOfWork.run<Result<CredentialOutput, DomainError>>(async (tx) => {
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      let credential: Credential;
      try {
        credential = Credential.issue(
          id,
          {
            principalRef: principal.id.toString(),
            kind: input.kind,
            fingerprint,
            kmsKeyRef,
            expiresAt: input.expiresAt != null ? new Date(input.expiresAt) : null,
          },
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.credentials.save(credential, tx);
      await recordAudit(this.deps, tx, {
        principalRef: principal.externalId,
        action: "security.credential.issued",
        decision: "allow",
        tenantRef: principal.tenantRef,
        metadata: { kind: input.kind },
      });
      return ok(present(credential));
    });
  }
}

export interface RotateCredentialInput {
  readonly credentialId: string;
  readonly newMaterial: string;
}

/**
 * Rotates a credential: the current one is marked `rotated` and a new active credential is issued
 * that `supersedes` it (auditable lineage), with a rotated KMS key ref. Emits
 * `security.credential.rotated` + `security.credential.issued` + audit.
 */
export class RotateCredential implements UseCase<
  RotateCredentialInput,
  CredentialOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RotateCredentialInput): Promise<Result<CredentialOutput, DomainError>> {
    const current = await this.deps.credentials.findById(input.credentialId);
    if (current === null) return err(new NotFoundError("Credential not found"));
    if (!current.isActive)
      return err(new BusinessRuleError("Only an active credential can be rotated"));
    const nextKeyRef =
      current.kmsKeyRef !== null
        ? await this.deps.kms.rotate(current.kmsKeyRef)
        : await this.deps.kms.generateKeyRef(`credential:${current.kind}`);
    const fingerprint = await this.deps.kms.fingerprint(input.newMaterial);
    return this.deps.unitOfWork.run<Result<CredentialOutput, DomainError>>(async (tx) => {
      const now = this.deps.clock.now();
      try {
        current.markRotated(this.deps.idGenerator.generate(), now);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      const replacement = Credential.issue(
        UniqueEntityId.from(this.deps.idGenerator.generate()),
        {
          principalRef: current.principalRef,
          kind: current.kind,
          fingerprint,
          kmsKeyRef: nextKeyRef,
          supersedesRef: current.id.toString(),
          expiresAt: current.expiresAt,
          rotationPolicy: current.rotationPolicy,
        },
        this.deps.idGenerator.generate(),
        now,
      );
      await this.deps.credentials.save(current, tx);
      await this.deps.credentials.save(replacement, tx);
      this.deps.telemetry.increment("security.credential.rotated");
      await recordAudit(this.deps, tx, {
        principalRef: current.principalRef,
        action: "security.credential.rotated",
        decision: "allow",
        metadata: { supersedes: current.id.toString() },
      });
      return ok(present(replacement));
    });
  }
}

export interface RevokeCredentialInput {
  readonly credentialId: string;
}

/** Revokes a credential immediately. Emits `security.credential.revoked` + audit. */
export class RevokeCredential implements UseCase<
  RevokeCredentialInput,
  CredentialOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(input: RevokeCredentialInput): Promise<Result<CredentialOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<CredentialOutput, DomainError>>(async (tx) => {
      const credential = await this.deps.credentials.findById(input.credentialId, tx);
      if (credential === null) return err(new NotFoundError("Credential not found"));
      try {
        credential.revoke(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.credentials.save(credential, tx);
      await recordAudit(this.deps, tx, {
        principalRef: credential.principalRef,
        action: "security.credential.revoked",
        decision: "allow",
      });
      return ok(present(credential));
    });
  }
}

export interface ScheduleCredentialRotationInput {
  readonly credentialId: string;
  readonly intervalDays: number;
  readonly graceSeconds: number;
  readonly autoRotate?: boolean;
}

/** Attaches a rotation policy to a credential (interval + grace + auto). Emits `rotation_scheduled`. */
export class ScheduleCredentialRotation implements UseCase<
  ScheduleCredentialRotationInput,
  CredentialOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: ScheduleCredentialRotationInput,
  ): Promise<Result<CredentialOutput, DomainError>> {
    const policy = RotationPolicy.create({
      intervalDays: input.intervalDays,
      graceSeconds: input.graceSeconds,
      autoRotate: input.autoRotate ?? true,
    });
    if (!policy.ok) return err(policy.error);
    return this.deps.unitOfWork.run<Result<CredentialOutput, DomainError>>(async (tx) => {
      const credential = await this.deps.credentials.findById(input.credentialId, tx);
      if (credential === null) return err(new NotFoundError("Credential not found"));
      try {
        credential.scheduleRotation(
          policy.value,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.credentials.save(credential, tx);
      await recordAudit(this.deps, tx, {
        principalRef: credential.principalRef,
        action: "security.credential.rotation_scheduled",
        decision: "allow",
        metadata: { intervalDays: String(input.intervalDays) },
      });
      return ok(present(credential));
    });
  }
}

export interface RotateDueCredentialsOutput {
  readonly rotated: number;
}

/**
 * Rotates every credential whose scheduled rotation is due and whose policy is auto-rotate — the
 * scheduler-driven automatic rotation (§7). Each due credential is marked rotated (grace applied) and
 * a fresh credential issued via {@link KmsPort}. Idempotent by due-time; safe to run repeatedly.
 */
export class RotateDueCredentials implements UseCase<
  Record<string, never>,
  RotateDueCredentialsOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(): Promise<Result<RotateDueCredentialsOutput, DomainError>> {
    const now = this.deps.clock.now();
    const due = (await this.deps.credentials.listDueForRotation(now)).filter((c) => c.autoRotate);
    let rotated = 0;
    for (const current of due) {
      const nextKeyRef =
        current.kmsKeyRef !== null
          ? await this.deps.kms.rotate(current.kmsKeyRef)
          : await this.deps.kms.generateKeyRef(`credential:${current.kind}`);
      const fingerprint = await this.deps.kms.fingerprint(await this.deps.crypto.randomToken(24));
      await this.deps.unitOfWork.run(async (tx) => {
        current.markRotated(this.deps.idGenerator.generate(), now);
        const replacement = Credential.issue(
          UniqueEntityId.from(this.deps.idGenerator.generate()),
          {
            principalRef: current.principalRef,
            kind: current.kind,
            fingerprint,
            kmsKeyRef: nextKeyRef,
            supersedesRef: current.id.toString(),
            expiresAt: current.expiresAt,
            rotationPolicy: current.rotationPolicy,
          },
          this.deps.idGenerator.generate(),
          now,
        );
        await this.deps.credentials.save(current, tx);
        await this.deps.credentials.save(replacement, tx);
        this.deps.telemetry.increment("security.credential.rotated");
        await recordAudit(this.deps, tx, {
          principalRef: current.principalRef,
          action: "security.credential.rotated",
          decision: "allow",
          metadata: { auto: "true", supersedes: current.id.toString() },
        });
      });
      rotated += 1;
    }
    return ok({ rotated });
  }
}

export interface EmergencyRevokeCredentialsInput {
  readonly principalExternalId: string;
  readonly reason: string;
}

export interface EmergencyRevokeOutput {
  readonly revoked: number;
}

/** Emergency revoke — revokes every non-terminal credential for a principal at once (§7 breach response). */
export class EmergencyRevokeCredentials implements UseCase<
  EmergencyRevokeCredentialsInput,
  EmergencyRevokeOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: EmergencyRevokeCredentialsInput,
  ): Promise<Result<EmergencyRevokeOutput, DomainError>> {
    const principal = await this.deps.principals.findByExternalId(input.principalExternalId);
    if (principal === null) return err(new NotFoundError("Principal not found"));
    return this.deps.unitOfWork.run<Result<EmergencyRevokeOutput, DomainError>>(async (tx) => {
      const credentials = await this.deps.credentials.listByPrincipal(principal.id.toString(), tx);
      let revoked = 0;
      for (const credential of credentials) {
        if (credential.status === "revoked" || credential.status === "expired") continue;
        credential.revoke(this.deps.idGenerator.generate(), this.deps.clock.now());
        await this.deps.credentials.save(credential, tx);
        revoked += 1;
      }
      await recordAudit(this.deps, tx, {
        principalRef: principal.externalId,
        action: "security.credential.emergency_revoked",
        decision: "allow",
        tenantRef: principal.tenantRef,
        metadata: { revoked: String(revoked), reason: input.reason },
      });
      return ok({ revoked });
    });
  }
}

export interface CredentialLineageInput {
  readonly credentialId: string;
}

export interface CredentialLineageOutput {
  /** The credential chain oldest → newest (following `supersedesRef`). */
  readonly chain: readonly CredentialOutput[];
}

/** Returns a credential's rotation lineage (the superseded-by chain) for audit/forensics (§7). */
export class GetCredentialLineage implements UseCase<
  CredentialLineageInput,
  CredentialLineageOutput,
  DomainError
> {
  constructor(private readonly deps: SecurityDeps) {}
  async execute(
    input: CredentialLineageInput,
  ): Promise<Result<CredentialLineageOutput, DomainError>> {
    const start = await this.deps.credentials.findById(input.credentialId);
    if (start === null) return err(new NotFoundError("Credential not found"));
    const chain: Credential[] = [start];
    const seen = new Set<string>([start.id.toString()]);
    let cursor: Credential | null = start;
    while (cursor !== null && cursor.supersedesRef !== null && !seen.has(cursor.supersedesRef)) {
      seen.add(cursor.supersedesRef);
      const prev: Credential | null = await this.deps.credentials.findById(cursor.supersedesRef);
      if (prev === null) break;
      chain.unshift(prev);
      cursor = prev;
    }
    return ok({ chain: chain.map(present) });
  }
}
