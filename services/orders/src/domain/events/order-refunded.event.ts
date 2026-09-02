import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface OrderRefundedData {
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly currency: string;
  readonly totalAmountMinor: number;
}

/** Raised when a paid order is refunded. */
export class OrderRefunded extends DomainEvent {
  readonly eventName = "order.refunded";
  readonly data: OrderRefundedData;

  constructor(props: DomainEventProps, data: OrderRefundedData) {
    super(props);
    this.data = data;
  }
}
