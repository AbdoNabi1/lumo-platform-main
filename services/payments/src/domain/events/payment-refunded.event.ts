import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface PaymentRefundedData {
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/** Raised when a refund is issued against a captured payment intent. */
export class PaymentRefunded extends DomainEvent {
  readonly eventName = "payment.refunded";
  readonly data: PaymentRefundedData;

  constructor(props: DomainEventProps, data: PaymentRefundedData) {
    super(props);
    this.data = data;
  }
}
