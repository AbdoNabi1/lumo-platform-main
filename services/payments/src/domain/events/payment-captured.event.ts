import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface PaymentCapturedData {
  readonly orderRef: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/** Raised when a payment intent is captured — drives the order to paid. */
export class PaymentCaptured extends DomainEvent {
  readonly eventName = "payment.captured";
  readonly data: PaymentCapturedData;

  constructor(props: DomainEventProps, data: PaymentCapturedData) {
    super(props);
    this.data = data;
  }
}
