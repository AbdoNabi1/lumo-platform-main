import { AggregateRoot, type UniqueEntityId } from "@platform/domain";
import { MembershipCreated } from "./events/membership-created.event";
import { MembershipRoleChanged } from "./events/membership-role-changed.event";
import type { RoleName } from "./value-objects/role-name";

interface MembershipProps {
  readonly tenantId: string;
  /** Bare reference (D-002) — no FK to `User`. */
  readonly userId: string;
  /** Bare reference (D-002) — no FK to `Organization`. */
  readonly organizationId: string;
  roleName: RoleName;
}

/** Links a user to an organization with a role NAME reference — never evaluates permissions. */
export class Membership extends AggregateRoot<MembershipProps> {
  static create(
    id: UniqueEntityId,
    tenantId: string,
    userId: string,
    organizationId: string,
    roleName: RoleName,
    eventId: string,
    occurredAt: Date,
  ): Membership {
    const membership = new Membership({ tenantId, userId, organizationId, roleName }, id);
    membership.addDomainEvent(
      new MembershipCreated(
        { eventId, aggregateId: membership.id, occurredAt },
        { tenantId, userId, organizationId, roleName: roleName.value },
      ),
    );
    return membership;
  }

  static reconstitute(
    id: UniqueEntityId,
    tenantId: string,
    userId: string,
    organizationId: string,
    roleName: RoleName,
    version: number,
  ): Membership {
    return new Membership({ tenantId, userId, organizationId, roleName }, id, version);
  }

  changeRole(roleName: RoleName, eventId: string, occurredAt: Date): void {
    this.props.roleName = roleName;
    this.addDomainEvent(
      new MembershipRoleChanged(
        { eventId, aggregateId: this.id, occurredAt },
        {
          tenantId: this.props.tenantId,
          userId: this.props.userId,
          organizationId: this.props.organizationId,
          roleName: roleName.value,
        },
      ),
    );
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get roleName(): RoleName {
    return this.props.roleName;
  }
}
