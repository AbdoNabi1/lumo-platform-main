import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface UserDeactivatedData {
  readonly tenantId: string;
}

/** Raised when a user is deactivated (soft, reversible only via a separate reactivation path). */
export class UserDeactivated extends DomainEvent {
  readonly eventName = "user.deactivated";
  readonly data: UserDeactivatedData;

  constructor(props: DomainEventProps, data: UserDeactivatedData) {
    super(props);
    this.data = data;
  }
}
