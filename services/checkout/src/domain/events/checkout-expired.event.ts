import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CheckoutExpiredData {
  readonly cartRef: string;
  readonly customerRef?: string;
}

/** Raised when a checkout session expires (TTL sweep or explicit command). */
export class CheckoutExpired extends DomainEvent {
  readonly eventName = "checkout_session.expired";
  readonly data: CheckoutExpiredData;

  constructor(props: DomainEventProps, data: CheckoutExpiredData) {
    super(props);
    this.data = data;
  }
}
