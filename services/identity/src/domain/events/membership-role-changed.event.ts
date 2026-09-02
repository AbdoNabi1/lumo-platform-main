import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface MembershipRoleChangedData {
  readonly tenantId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly roleName: string;
}

/** Raised when a membership's role name reference is changed. */
export class MembershipRoleChanged extends DomainEvent {
  readonly eventName = "membership.role_changed";
  readonly data: MembershipRoleChangedData;

  constructor(props: DomainEventProps, data: MembershipRoleChangedData) {
    super(props);
    this.data = data;
  }
}
