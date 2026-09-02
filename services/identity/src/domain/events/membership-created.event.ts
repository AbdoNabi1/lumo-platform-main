import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface MembershipCreatedData {
  readonly tenantId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly roleName: string;
}

/** Raised when a user is added to an organization with a role. */
export class MembershipCreated extends DomainEvent {
  readonly eventName = "membership.created";
  readonly data: MembershipCreatedData;

  constructor(props: DomainEventProps, data: MembershipCreatedData) {
    super(props);
    this.data = data;
  }
}
