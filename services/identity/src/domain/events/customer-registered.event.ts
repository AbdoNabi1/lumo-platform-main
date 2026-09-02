import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CustomerRegisteredData {
  readonly email: string;
  readonly name: string;
}

/** Raised when a customer registers. */
export class CustomerRegistered extends DomainEvent {
  readonly eventName = "customer.registered";
  readonly data: CustomerRegisteredData;

  constructor(props: DomainEventProps, data: CustomerRegisteredData) {
    super(props);
    this.data = data;
  }
}
