import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";
import { SecurityScope, type SecurityScopeProps } from "./value-objects/security-scope";

export const DELEGATION_STATUSES = ["active", "revoked", "expired"] as const;
export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];

interface DelegationProps {
  /** The principal whose authority is delegated (the "acted-as" identity in an impersonation). */
  readonly delegatorRef: string;
  /** The principal granted the ability to act as the delegator. */
  readonly delegateRef: string;
  scope: SecurityScope;
  /** Optional narrowing to specific permissions; empty ⇒ the delegator's full authority within scope. */
  readonly permissions: readonly string[];
  status: DelegationStatus;
  readonly expiresAt: Date | null;
  readonly reason: string | null;
  readonly grantedAt: Date;
}

/**
 * A **delegation** — one principal (`delegateRef`) may act as another (`delegatorRef`) within a
 * scope, optionally narrowed to specific permissions, and time-boxed. It is the foundation for
 * **impersonation**: an impersonation {@link Session} carries `impersonatedBy = delegateRef` +
 * `delegationRef`. Every grant/use is WORM-audited (ADR-0023). Self-delegation is rejected.
 */
export class Delegation extends AggregateRoot<DelegationProps> {
  static grant(
    id: UniqueEntityId,
    input: {
      readonly delegatorRef: string;
      readonly delegateRef: string;
      readonly scope?: SecurityScopeProps;
      readonly permissions?: readonly string[];
      readonly expiresAt?: Date | null;
      readonly reason?: string | null;
    },
    eventId: string,
    occurredAt: Date,
  ): Delegation {
    if (input.delegatorRef.trim().length === 0)
      throw new BusinessRuleError("A delegation needs a delegatorRef");
    if (input.delegateRef.trim().length === 0)
      throw new BusinessRuleError("A delegation needs a delegateRef");
    if (input.delegatorRef.trim() === input.delegateRef.trim())
      throw new BusinessRuleError("A principal cannot delegate to itself");
    if (input.expiresAt != null && input.expiresAt.getTime() <= occurredAt.getTime())
      throw new BusinessRuleError("A delegation cannot be granted already expired");
    const delegation = new Delegation(
      {
        delegatorRef: input.delegatorRef.trim(),
        delegateRef: input.delegateRef.trim(),
        scope: input.scope === undefined ? SecurityScope.platform() : SecurityScope.of(input.scope),
        permissions: [...(input.permissions ?? [])],
        status: "active",
        expiresAt: input.expiresAt ?? null,
        reason: input.reason ?? null,
        grantedAt: occurredAt,
      },
      id,
    );
    delegation.emit("security.delegation.granted", eventId, occurredAt);
    return delegation;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: Omit<DelegationProps, "scope"> & {
      readonly scope: SecurityScope;
      readonly version: number;
    },
  ): Delegation {
    return new Delegation({ ...base, permissions: [...base.permissions] }, id, base.version);
  }

  revoke(eventId: string, occurredAt: Date): void {
    if (this.props.status !== "active") return;
    this.props.status = "revoked";
    this.emit("security.delegation.revoked", eventId, occurredAt);
  }

  expireIfDue(now: Date, eventId: string): boolean {
    if (this.props.status !== "active" || this.props.expiresAt === null) return false;
    if (this.props.expiresAt.getTime() > now.getTime()) return false;
    this.props.status = "expired";
    this.emit("security.delegation.revoked", eventId, now);
    return true;
  }

  get delegatorRef(): string {
    return this.props.delegatorRef;
  }
  get delegateRef(): string {
    return this.props.delegateRef;
  }
  get scope(): SecurityScope {
    return this.props.scope;
  }
  get permissions(): readonly string[] {
    return this.props.permissions;
  }
  get status(): DelegationStatus {
    return this.props.status;
  }
  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }
  get reason(): string | null {
    return this.props.reason;
  }
  get grantedAt(): Date {
    return this.props.grantedAt;
  }

  isActiveAt(now: Date): boolean {
    if (this.props.status !== "active") return false;
    return this.props.expiresAt === null || this.props.expiresAt.getTime() > now.getTime();
  }

  private emit(event: SecurityEventName, eventId: string, occurredAt: Date): void {
    this.addDomainEvent(
      new SecurityChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          aggregateId: this.id.toString(),
          aggregate: "delegation",
          key: `${this.props.delegateRef}->${this.props.delegatorRef}`,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}
