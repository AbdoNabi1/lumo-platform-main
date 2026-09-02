import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface PaymentFailedData {
  readonly orderRef: string;
  readonly reason: string;
}

/** Raised when a payment intent fails — the checkout saga compensates (releases stock). */
export class PaymentFailed extends DomainEvent {
  readonly eventName = "payment.failed";
  readonly data: PaymentFailedData;

  constructor(props: DomainEventProps, data: PaymentFailedData) {
    super(props);
    this.data = data;
  }
}
