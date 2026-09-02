import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CheckoutCompletedData {
  readonly cartRef: string;
  readonly customerRef: string;
  readonly orderRef: string;
}

/** Raised when a checkout session completes (an order was placed + paid). */
export class CheckoutCompleted extends DomainEvent {
  readonly eventName = "checkout.completed";
  readonly data: CheckoutCompletedData;

  constructor(props: DomainEventProps, data: CheckoutCompletedData) {
    super(props);
    this.data = data;
  }
}
