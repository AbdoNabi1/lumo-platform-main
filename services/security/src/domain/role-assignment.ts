import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import { SecurityChanged, type SecurityEventName } from "./events/security-changed.event";
import { SecurityScope, type SecurityScopeProps } from "./value-objects/security-scope";

export const ASSIGNMENT_STATUSES = ["active", "revoked", "expired"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

interface RoleAssignmentProps {
  readonly principalRef: string;
  readonly roleKey: string;
  scope: SecurityScope;
  /** The principal that granted this assignment (delegated administration / audit trail). */
  readonly grantedBy: string;
  status: AssignmentStatus;
  /** Temporary elevation / just-in-time: the grant auto-expires. Null ⇒ standing assignment. */
  readonly expiresAt: Date | null;
  readonly reason: string | null;
  readonly grantedAt: Date;
}

/**
 * A **role assignment** — the binding of a role to a principal at a concrete scope. Supports
 * **temporary elevation / JIT** (`expiresAt`) and **delegated administration** (`grantedBy`). The
 * authorization evaluator only counts an assignment that is active *and* not past its expiry
 * (ADR-0023, sprint Part 2).
 */
export class RoleAssignment extends AggregateRoot<RoleAssignmentProps> {
  static grant(
    id: UniqueEntityId,
    input: {
      readonly principalRef: string;
      readonly roleKey: string;
      readonly grantedBy: string;
      readonly scope?: SecurityScopeProps;
      readonly expiresAt?: Date | null;
      readonly reason?: string | null;
    },
    eventId: string,
    occurredAt: Date,
  ): RoleAssignment {
    if (input.principalRef.trim().length === 0)
      throw new BusinessRuleError("An assignment needs a principalRef");
    if (input.roleKey.trim().length === 0)
      throw new BusinessRuleError("An assignment needs a roleKey");
    if (input.grantedBy.trim().length === 0)
      throw new BusinessRuleError("An assignment needs a granting principal (grantedBy)");
    if (input.expiresAt != null && input.expiresAt.getTime() <= occurredAt.getTime()) {
      throw new BusinessRuleError("A temporary elevation cannot be granted already expired");
    }
    const assignment = new RoleAssignment(
      {
        principalRef: input.principalRef.trim(),
        roleKey: input.roleKey.trim(),
        scope: input.scope === undefined ? SecurityScope.platform() : SecurityScope.of(input.scope),
        grantedBy: input.grantedBy.trim(),
        status: "active",
        expiresAt: input.expiresAt ?? null,
        reason: input.reason ?? null,
        grantedAt: occurredAt,
      },
      id,
    );
    assignment.emit("security.role.assigned", eventId, occurredAt);
    return assignment;
  }

  static reconstitute(
    id: UniqueEntityId,
    base: Omit<RoleAssignmentProps, "scope"> & {
      readonly scope: SecurityScope;
      readonly version: number;
    },
  ): RoleAssignment {
    return new RoleAssignment({ ...base }, id, base.version);
  }

  revoke(eventId: string, occurredAt: Date): void {
    if (this.props.status !== "active") return;
    this.props.status = "revoked";
    this.emit("security.role.revoked", eventId, occurredAt);
  }

  expireIfDue(now: Date, eventId: string): boolean {
    if (this.props.status !== "active" || this.props.expiresAt === null) return false;
    if (this.props.expiresAt.getTime() > now.getTime()) return false;
    this.props.status = "expired";
    this.emit("security.role.revoked", eventId, now);
    return true;
  }

  get principalRef(): string {
    return this.props.principalRef;
  }
  get roleKey(): string {
    return this.props.roleKey;
  }
  get scope(): SecurityScope {
    return this.props.scope;
  }
  get grantedBy(): string {
    return this.props.grantedBy;
  }
  get status(): AssignmentStatus {
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
  get isTemporary(): boolean {
    return this.props.expiresAt !== null;
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
          aggregate: "role",
          key: `${this.props.principalRef}:${this.props.roleKey}`,
          event,
          status: this.props.status,
        },
      ),
    );
  }
}
