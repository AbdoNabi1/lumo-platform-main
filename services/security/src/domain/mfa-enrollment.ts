import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";
import type { MfaMethodKind } from "./value-objects/auth-method";

export const MFA_ENROLLMENT_STATUSES = ["pending", "active", "revoked"] as const;
export type MfaEnrollmentStatus = (typeof MFA_ENROLLMENT_STATUSES)[number];

interface MfaEnrollmentProps {
  readonly principalRef: string;
  readonly method: MfaMethodKind;
  status: MfaEnrollmentStatus;
  /** Reference to the method secret (TOTP seed / WebAuthn credential) — never the value itself. */
  readonly secretRef: string | null;
  /** Non-reversible hashes of one-time backup codes; consumed codes are removed. */
  backupCodeHashes: string[];
  /** Device bound to a WebAuthn/passkey enrollment, when applicable. */
  readonly deviceRef: string | null;
  readonly createdAt: Date;
  activatedAt: Date | null;
}

/**
 * An **MFA enrollment** — a principal's registration of one MFA method (sprint P2.0-B §2). The method
 * secret is referenced, never stored; backup codes are stored only as non-reversible hashes and
 * removed when consumed. Verification of a submitted code is a provider concern (`MfaProviderPort`);
 * the aggregate owns the durable enrollment + lifecycle (enroll → verify/activate → revoke).
 */
export class MfaEnrollment extends AggregateRoot<MfaEnrollmentProps> {
  static enroll(
    id: UniqueEntityId,
    input: {
      readonly principalRef: string;
      readonly method: MfaMethodKind;
      readonly secretRef?: string | null;
      readonly deviceRef?: string | null;
      readonly backupCodeHashes?: readonly string[];
    },
    eventId: string,
    occurredAt: Date,
  ): MfaEnrollment {
    if (input.principalRef.trim().length === 0)
      throw new BusinessRuleError("An MFA enrollment needs a principalRef");
    const enrollment = new MfaEnrollment(
      {
        principalRef: input.principalRef.trim(),
        method: input.method,
        status: "pending",
        secretRef: input.secretRef ?? null,
        backupCodeHashes: [...(input.backupCodeHashes ?? [])],
        deviceRef: input.deviceRef ?? null,
        createdAt: occurredAt,
        activatedAt: null,
      },
      id,
    );
    enrollment.emit("security.mfa.enrolled", eventId, occurredAt);
    return enrollment;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: MfaEnrollmentProps & { readonly version: number },
  ): MfaEnrollment {
    return new MfaEnrollment(
      { ...base, backupCodeHashes: [...base.backupCodeHashes] },
      id,
      base.version,
    );
  }

  /** Activates the enrollment after the provider verified the first code. */
  markVerified(eventId: string, occurredAt: Date): void {
    if (this.props.status === "revoked")
      throw new BusinessRuleError("A revoked MFA enrollment cannot be verified");
    if (this.props.status === "active") return;
    this.props.status = "active";
    this.props.activatedAt = occurredAt;
    this.emit("security.mfa.verified", eventId, occurredAt);
  }

  setBackupCodes(hashes: readonly string[]): void {
    this.props.backupCodeHashes = [...hashes];
  }

  /** Consumes a backup code by its hash (one-time). Returns true when the code was present. */
  consumeBackupCode(hash: string): boolean {
    if (!this.props.backupCodeHashes.includes(hash)) return false;
    this.props.backupCodeHashes = this.props.backupCodeHashes.filter((h) => h !== hash);
    return true;
  }

  revoke(eventId: string, occurredAt: Date): void {
    if (this.props.status === "revoked") return;
    this.props.status = "revoked";
    this.emit("security.mfa.revoked", eventId, occurredAt);
  }

  get principalRef(): string {
    return this.props.principalRef;
  }
  get method(): MfaMethodKind {
    return this.props.method;
  }
  get status(): MfaEnrollmentStatus {
    return this.props.status;
  }
  get secretRef(): string | null {
    return this.props.secretRef;
  }
  get deviceRef(): string | null {
    return this.props.deviceRef;
  }
  get remainingBackupCodes(): number {
    return this.props.backupCodeHashes.length;
  }
  /** The non-reversible backup-code hashes (persistence/read; never plaintext codes). */
  get backupCodeHashes(): readonly string[] {
    return this.props.backupCodeHashes;
  }
  get activatedAt(): Date | null {
    return this.props.activatedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get isActive(): boolean {
    return this.props.status === "active";
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "mfa",
          key: `${this.props.principalRef}:${this.props.method}`,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}
