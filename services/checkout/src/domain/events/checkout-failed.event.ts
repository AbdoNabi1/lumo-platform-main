import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CheckoutFailedData {
  readonly cartRef: string;
  readonly customerRef: string;
  readonly reason: string;
}

/** Raised when a checkout session fails (a saga step failed + compensated). */
export class CheckoutFailed extends DomainEvent {
  readonly eventName = "checkout.failed";
  readonly data: CheckoutFailedData;

  constructor(props: DomainEventProps, data: CheckoutFailedData) {
    super(props);
    this.data = data;
  }
}
