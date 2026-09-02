import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";

export const SESSION_STATUSES = ["active", "expired", "revoked"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

interface SessionProps {
  readonly principalRef: string;
  status: SessionStatus;
  /**
   * The **external identity provider's** session id (Kratos `sid` / OIDC `sid`) this session mirrors,
   * or `null` for a session Security minted on its own. Immutable: a mirror never re-points at a
   * different upstream session — the upstream ending means this session is revoked/expired, not
   * rebound (ADR-0031).
   */
  readonly externalRef: string | null;
  readonly deviceRef: string | null;
  /** Non-reversible fingerprint of the current refresh token — rotated on every refresh. */
  refreshFingerprint: string;
  refreshCount: number;
  /** Risk snapshot (0–100) at last evaluation; the zero-trust decision reads this. */
  riskAtLastEval: number;
  /** Delegating principal when this session is an impersonation (else null) — sprint Part: delegation. */
  readonly impersonatedBy: string | null;
  readonly delegationRef: string | null;
  readonly establishedAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

/**
 * A **session** — an authenticated principal's living context. Security owns the lifecycle
 * (establish → refresh-with-rotation → revoke → expire); Kratos remains the enforcement point for
 * token issuance. Refresh **rotates** the token fingerprint (no reuse). A session may be an
 * impersonation carrying `impersonatedBy` + `delegationRef` (ADR-0023, sprint Part 1).
 */
export class Session extends AggregateRoot<SessionProps> {
  static establish(
    id: UniqueEntityId,
    input: {
      readonly principalRef: string;
      readonly refreshFingerprint: string;
      readonly externalRef?: string | null;
      readonly deviceRef?: string | null;
      readonly riskAtLastEval?: number;
      readonly impersonatedBy?: string | null;
      readonly delegationRef?: string | null;
      readonly expiresAt: Date;
    },
    eventId: string,
    occurredAt: Date,
  ): Session {
    if (input.principalRef.trim().length === 0)
      throw new BusinessRuleError("A session needs a principalRef");
    if (input.refreshFingerprint.trim().length === 0)
      throw new BusinessRuleError("A session needs a refresh token fingerprint");
    if (input.expiresAt.getTime() <= occurredAt.getTime())
      throw new BusinessRuleError("A session cannot be established already expired");
    const impersonatedBy = input.impersonatedBy ?? null;
    const delegationRef = input.delegationRef ?? null;
    if ((impersonatedBy === null) !== (delegationRef === null)) {
      throw new BusinessRuleError(
        "An impersonation session requires both impersonatedBy and delegationRef",
      );
    }
    const session = new Session(
      {
        principalRef: input.principalRef.trim(),
        status: "active",
        externalRef: normalizeExternalRef(input.externalRef),
        deviceRef: input.deviceRef ?? null,
        refreshFingerprint: input.refreshFingerprint.trim(),
        refreshCount: 0,
        riskAtLastEval: clampRisk(input.riskAtLastEval ?? 0),
        impersonatedBy,
        delegationRef,
        establishedAt: occurredAt,
        lastSeenAt: occurredAt,
        expiresAt: input.expiresAt,
      },
      id,
    );
    session.emit("security.session.established", eventId, occurredAt);
    return session;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: SessionProps & { readonly version: number },
  ): Session {
    return new Session({ ...base }, id, base.version);
  }

  /** Rotates the refresh token and extends the session. Active sessions only. */
  refresh(newFingerprint: string, expiresAt: Date, eventId: string, occurredAt: Date): void {
    if (this.props.status !== "active")
      throw new BusinessRuleError(
        `Only an active session can be refreshed (is "${this.props.status}")`,
      );
    if (newFingerprint.trim().length === 0)
      throw new BusinessRuleError("Refresh requires a new token fingerprint");
    if (newFingerprint.trim() === this.props.refreshFingerprint)
      throw new BusinessRuleError("Refresh must rotate the token (reuse rejected)");
    if (expiresAt.getTime() <= occurredAt.getTime())
      throw new BusinessRuleError("Refreshed session expiry must be in the future");
    this.props.refreshFingerprint = newFingerprint.trim();
    this.props.refreshCount += 1;
    this.props.lastSeenAt = occurredAt;
    this.props.expiresAt = expiresAt;
    this.emit("security.session.refreshed", eventId, occurredAt);
  }

  recordRisk(risk: number): void {
    this.props.riskAtLastEval = clampRisk(risk);
  }

  revoke(eventId: string, occurredAt: Date): void {
    if (this.props.status === "revoked") return;
    this.props.status = "revoked";
    this.emit("security.session.revoked", eventId, occurredAt);
  }

  expireIfDue(now: Date, eventId: string): boolean {
    if (this.props.status !== "active") return false;
    if (this.props.expiresAt.getTime() > now.getTime()) return false;
    this.props.status = "expired";
    this.emit("security.session.expired", eventId, now);
    return true;
  }

  get principalRef(): string {
    return this.props.principalRef;
  }
  get status(): SessionStatus {
    return this.props.status;
  }
  /** The mirrored upstream (Kratos/OIDC) session id, or `null` for a Security-native session. */
  get externalRef(): string | null {
    return this.props.externalRef;
  }
  get deviceRef(): string | null {
    return this.props.deviceRef;
  }
  get refreshCount(): number {
    return this.props.refreshCount;
  }
  get riskAtLastEval(): number {
    return this.props.riskAtLastEval;
  }
  get impersonatedBy(): string | null {
    return this.props.impersonatedBy;
  }
  get delegationRef(): string | null {
    return this.props.delegationRef;
  }
  /** Non-reversible current refresh-token fingerprint (persistence/read; never the token itself). */
  get refreshFingerprint(): string {
    return this.props.refreshFingerprint;
  }
  get establishedAt(): Date {
    return this.props.establishedAt;
  }
  get lastSeenAt(): Date {
    return this.props.lastSeenAt;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get isActive(): boolean {
    return this.props.status === "active";
  }
  isValidAt(now: Date): boolean {
    return this.props.status === "active" && this.props.expiresAt.getTime() > now.getTime();
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "session",
          key: this.props.principalRef,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}

/** An external ref is either absent or a non-blank upstream id — never an empty string. */
function normalizeExternalRef(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new BusinessRuleError("An external session ref cannot be blank");
  return trimmed;
}

function clampRisk(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
