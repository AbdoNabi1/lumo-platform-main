import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface OrderPaidData {
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly paymentRef: string;
  readonly currency: string;
  readonly totalAmountMinor: number;
}

/** Raised when an order is marked paid — consumed by Inventory (decrement) + Notifications. */
export class OrderPaid extends DomainEvent {
  readonly eventName = "order.paid";
  readonly data: OrderPaidData;

  constructor(props: DomainEventProps, data: OrderPaidData) {
    super(props);
    this.data = data;
  }
}
