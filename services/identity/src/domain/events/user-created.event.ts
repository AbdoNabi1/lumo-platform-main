import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface UserCreatedData {
  readonly tenantId: string;
  readonly email: string;
}

/** Raised when a user is created within a tenant. */
export class UserCreated extends DomainEvent {
  readonly eventName = "user.created";
  readonly data: UserCreatedData;

  constructor(props: DomainEventProps, data: UserCreatedData) {
    super(props);
    this.data = data;
  }
}
