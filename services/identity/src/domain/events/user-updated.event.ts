import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface UserUpdatedData {
  readonly tenantId: string;
}

/** Raised when a user's own profile fields (name) are changed. */
export class UserUpdated extends DomainEvent {
  readonly eventName = "user.updated";
  readonly data: UserUpdatedData;

  constructor(props: DomainEventProps, data: UserUpdatedData) {
    super(props);
    this.data = data;
  }
}
