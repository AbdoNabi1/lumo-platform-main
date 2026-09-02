import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { PaymentStatusValue } from "../value-objects/payment-status";

export interface PaymentTransitionedData {
  readonly orderRef: string;
  readonly fromStatus: PaymentStatusValue;
  readonly toStatus: PaymentStatusValue;
}

/** Raised on every validated lifecycle transition (Sprint 4.8). The translator maps this to `payments.intent.<status>`. */
export class PaymentTransitioned extends DomainEvent {
  readonly eventName = "payment.transitioned";
  readonly data: PaymentTransitionedData;

  constructor(props: DomainEventProps, data: PaymentTransitionedData) {
    super(props);
    this.data = data;
  }
}
