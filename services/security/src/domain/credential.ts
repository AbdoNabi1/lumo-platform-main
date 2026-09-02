import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";
import type { RotationPolicy } from "./value-objects/rotation-policy";

export const CREDENTIAL_KINDS = [
  "api_key",
  "secret",
  "certificate",
  "signing_key",
  "oauth_client",
] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** `active` credentials authenticate; `rotated`/`revoked`/`expired` are terminal (no re-activation). */
export const CREDENTIAL_STATUSES = ["active", "rotated", "revoked", "expired"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

interface CredentialProps {
  readonly principalRef: string;
  readonly kind: CredentialKind;
  /** Non-reversible fingerprint of the secret (supplied by infra) — the value NEVER enters the domain. */
  readonly fingerprint: string;
  /** Reference to KMS/Vault-managed key material (a pointer, not a secret) — {@link KmsPort}. Null until bound. */
  readonly kmsKeyRef: string | null;
  status: CredentialStatus;
  /** The credential this one rotated in for (rotation lineage), or null when first-issued. */
  readonly supersedesRef: string | null;
  readonly issuedAt: Date;
  readonly expiresAt: Date | null;
  /** Rotation policy (interval/grace/auto) governing this credential, or null (no schedule). */
  rotationPolicy: RotationPolicy | null;
  /** When the next scheduled rotation is due, or null. */
  rotationDueAt: Date | null;
  /** While `rotated`, the credential stays valid until this instant (grace/overlap window). */
  graceUntil: Date | null;
}

/**
 * A **credential** — an authenticator bound to a principal. Security owns the *lifecycle*
 * (issue → rotate → revoke → expire) and *references* to key material; it never stores a secret
 * value (only a non-reversible `fingerprint` + a `kmsKeyRef`). Rotation is modelled as a new
 * credential that `supersedes` the prior one, keeping an auditable lineage (ADR-0023, sprint Part 1/7).
 */
export class Credential extends AggregateRoot<CredentialProps> {
  static issue(
    id: UniqueEntityId,
    input: {
      readonly principalRef: string;
      readonly kind: CredentialKind;
      readonly fingerprint: string;
      readonly kmsKeyRef?: string | null;
      readonly supersedesRef?: string | null;
      readonly expiresAt?: Date | null;
      readonly rotationPolicy?: RotationPolicy | null;
    },
    eventId: string,
    occurredAt: Date,
  ): Credential {
    if (input.principalRef.trim().length === 0)
      throw new BusinessRuleError("A credential needs a principalRef");
    if (input.fingerprint.trim().length === 0)
      throw new BusinessRuleError(
        "A credential needs a fingerprint (the secret value is never stored)",
      );
    if (input.expiresAt != null && input.expiresAt.getTime() <= occurredAt.getTime()) {
      throw new BusinessRuleError("A credential cannot be issued already expired");
    }
    const rotationPolicy = input.rotationPolicy ?? null;
    const credential = new Credential(
      {
        principalRef: input.principalRef.trim(),
        kind: input.kind,
        fingerprint: input.fingerprint.trim(),
        kmsKeyRef: input.kmsKeyRef ?? null,
        status: "active",
        supersedesRef: input.supersedesRef ?? null,
        issuedAt: occurredAt,
        expiresAt: input.expiresAt ?? null,
        rotationPolicy,
        rotationDueAt: rotationPolicy === null ? null : rotationPolicy.nextDue(occurredAt),
        graceUntil: null,
      },
      id,
    );
    credential.emit("security.credential.issued", eventId, occurredAt);
    return credential;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: {
      readonly principalRef: string;
      readonly kind: CredentialKind;
      readonly fingerprint: string;
      readonly kmsKeyRef: string | null;
      readonly status: CredentialStatus;
      readonly supersedesRef: string | null;
      readonly issuedAt: Date;
      readonly expiresAt: Date | null;
      readonly rotationPolicy?: RotationPolicy | null;
      readonly rotationDueAt?: Date | null;
      readonly graceUntil?: Date | null;
      readonly version: number;
    },
  ): Credential {
    return new Credential(
      {
        ...base,
        rotationPolicy: base.rotationPolicy ?? null,
        rotationDueAt: base.rotationDueAt ?? null,
        graceUntil: base.graceUntil ?? null,
      },
      id,
      base.version,
    );
  }

  /** Attaches/updates the rotation policy and schedules the next rotation. Emits `rotation_scheduled`. */
  scheduleRotation(policy: RotationPolicy, eventId: string, occurredAt: Date): void {
    if (this.props.status !== "active")
      throw new BusinessRuleError("Only an active credential can be scheduled for rotation");
    this.props.rotationPolicy = policy;
    this.props.rotationDueAt = policy.nextDue(occurredAt);
    this.emit("security.credential.rotation_scheduled", eventId, occurredAt);
  }

  /**
   * Marks this credential rotated-out. If a grace window applies (from the policy or an override), the
   * credential stays valid until `graceUntil`; a superseding credential is issued by the use-case.
   */
  markRotated(eventId: string, occurredAt: Date, graceSecondsOverride?: number): void {
    if (this.props.status !== "active")
      throw new BusinessRuleError(
        `Only an active credential can be rotated (is "${this.props.status}")`,
      );
    const graceSeconds = graceSecondsOverride ?? this.props.rotationPolicy?.graceSeconds ?? 0;
    this.props.status = "rotated";
    this.props.graceUntil =
      graceSeconds > 0 ? new Date(occurredAt.getTime() + graceSeconds * 1000) : null;
    this.props.rotationDueAt = null;
    this.emit("security.credential.rotated", eventId, occurredAt);
  }

  /** True when this credential still authenticates: active, or rotated but within its grace window. */
  isValidAt(now: Date): boolean {
    if (this.props.status === "active")
      return this.props.expiresAt === null || this.props.expiresAt.getTime() > now.getTime();
    if (this.props.status === "rotated")
      return this.props.graceUntil !== null && this.props.graceUntil.getTime() > now.getTime();
    return false;
  }

  /** True when an active credential has reached its scheduled rotation time. */
  isDueForRotation(now: Date): boolean {
    return (
      this.props.status === "active" &&
      this.props.rotationDueAt !== null &&
      this.props.rotationDueAt.getTime() <= now.getTime()
    );
  }

  revoke(eventId: string, occurredAt: Date): void {
    if (this.props.status === "revoked") return;
    if (this.props.status === "expired")
      throw new BusinessRuleError("An expired credential cannot be revoked");
    this.props.status = "revoked";
    this.emit("security.credential.revoked", eventId, occurredAt);
  }

  /** Expires the credential if its `expiresAt` has passed. No-op when not applicable. */
  expireIfDue(now: Date, eventId: string): boolean {
    if (this.props.status !== "active" || this.props.expiresAt === null) return false;
    if (this.props.expiresAt.getTime() > now.getTime()) return false;
    this.props.status = "expired";
    this.emit("security.credential.expired", eventId, now);
    return true;
  }

  get principalRef(): string {
    return this.props.principalRef;
  }
  get kind(): CredentialKind {
    return this.props.kind;
  }
  get fingerprint(): string {
    return this.props.fingerprint;
  }
  get kmsKeyRef(): string | null {
    return this.props.kmsKeyRef;
  }
  get status(): CredentialStatus {
    return this.props.status;
  }
  get supersedesRef(): string | null {
    return this.props.supersedesRef;
  }
  get issuedAt(): Date {
    return this.props.issuedAt;
  }
  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }
  get rotationPolicy(): RotationPolicy | null {
    return this.props.rotationPolicy;
  }
  get rotationDueAt(): Date | null {
    return this.props.rotationDueAt;
  }
  get graceUntil(): Date | null {
    return this.props.graceUntil;
  }
  get autoRotate(): boolean {
    return this.props.rotationPolicy?.autoRotate ?? false;
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
          aggregate: "credential",
          key: this.props.principalRef,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}
