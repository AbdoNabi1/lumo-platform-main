import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { STAFF_ROLES, type StaffRole } from "./staff";

/** An invitation link stays valid for seven days (renewing restarts the clock). */
export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

export const STAFF_INVITATION_STATUSES = ["pending", "accepted", "revoked"] as const;
export type StaffInvitationStatus = (typeof STAFF_INVITATION_STATUSES)[number];

const NO_LONGER_VALID = "This invitation is no longer valid";

interface StaffInvitationProps {
  readonly tenantId: string;
  readonly email: string;
  readonly principalExternalId: string;
  readonly roleKey: StaffRole;
  readonly invitedBy: string;
  /** SHA-256 hex of the single-use token. The token itself is never stored. */
  tokenHash: string;
  status: StaffInvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  readonly createdAt: Date;
  updatedAt: Date;
}

export interface StaffInvitationInput {
  readonly tenantId: string;
  /** Already trimmed and lower-cased (the table CHECKs it too). */
  readonly email: string;
  readonly principalExternalId: string;
  readonly roleKey: StaffRole;
  readonly invitedBy: string;
  readonly tokenHash: string;
}

function assertTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new BusinessRuleError("An invitation needs a positive lifetime");
}

function assertTokenHash(tokenHash: string): void {
  if (tokenHash.trim().length === 0)
    throw new BusinessRuleError("An invitation needs a token hash");
}

/**
 * A **staff invitation** — a pending offer of a fixed staff role to an email address. Only the SHA-256
 * of its single-use token is held. Expiry is computed from `expiresAt` (there is no `expired` status).
 * Transitions: pending → accepted | revoked; a pending invitation (even an expired one) can be renewed,
 * which rotates the token hash and restarts the clock. Persistence owns `version` (compare-and-swap).
 */
export class StaffInvitation extends AggregateRoot<StaffInvitationProps> {
  static create(
    id: UniqueEntityId,
    input: StaffInvitationInput,
    now: Date,
    ttlMs: number = INVITATION_TTL_MS,
  ): StaffInvitation {
    const email = input.email;
    if (email.length === 0 || email !== email.trim().toLowerCase())
      throw new BusinessRuleError("An invitation needs a normalised email address");
    if (!STAFF_ROLES.includes(input.roleKey))
      throw new BusinessRuleError("An invitation needs a staff role (admin, operator or viewer)");
    if (input.tenantId.trim().length === 0)
      throw new BusinessRuleError("An invitation needs a tenant");
    if (input.principalExternalId.trim().length === 0)
      throw new BusinessRuleError("An invitation needs the invited principal");
    if (input.invitedBy.trim().length === 0)
      throw new BusinessRuleError("An invitation needs the inviting staff member");
    assertTokenHash(input.tokenHash);
    assertTtl(ttlMs);
    return new StaffInvitation(
      {
        tenantId: input.tenantId,
        email,
        principalExternalId: input.principalExternalId,
        roleKey: input.roleKey,
        invitedBy: input.invitedBy,
        tokenHash: input.tokenHash,
        status: "pending",
        expiresAt: new Date(now.getTime() + ttlMs),
        acceptedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      id,
    );
  }

  static reconstitute(
    id: UniqueEntityId,
    base: StaffInvitationProps & { readonly version: number },
  ): StaffInvitation {
    const { version, ...props } = base;
    return new StaffInvitation({ ...props }, id, version);
  }

  /** At/after `expiresAt` the invitation is expired (`expiresAt > now` ⇒ still valid). */
  isExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  accept(now: Date): void {
    if (this.props.status !== "pending" || this.isExpired(now))
      throw new BusinessRuleError(NO_LONGER_VALID);
    this.props.status = "accepted";
    this.props.acceptedAt = now;
    this.props.updatedAt = now;
  }

  revoke(now: Date): void {
    if (this.props.status !== "pending")
      throw new BusinessRuleError("Only a pending invitation can be revoked");
    this.props.status = "revoked";
    this.props.updatedAt = now;
  }

  /** Resend: new single-use token, seven fresh days. Only a pending invitation (expired or not). */
  renew(now: Date, ttlMs: number, tokenHash: string): void {
    if (this.props.status !== "pending")
      throw new BusinessRuleError("Only a pending invitation can be resent");
    assertTokenHash(tokenHash);
    assertTtl(ttlMs);
    this.props.tokenHash = tokenHash;
    this.props.expiresAt = new Date(now.getTime() + ttlMs);
    this.props.updatedAt = now;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }
  get email(): string {
    return this.props.email;
  }
  get principalExternalId(): string {
    return this.props.principalExternalId;
  }
  get roleKey(): StaffRole {
    return this.props.roleKey;
  }
  get invitedBy(): string {
    return this.props.invitedBy;
  }
  get tokenHash(): string {
    return this.props.tokenHash;
  }
  get status(): StaffInvitationStatus {
    return this.props.status;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get acceptedAt(): Date | null {
    return this.props.acceptedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
