import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { OrderEventType } from "../order-event";

export interface OrderTransitionedData {
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly fromStatus: OrderEventType;
  readonly toStatus: OrderEventType;
}

/** Raised on every validated lifecycle transition (Sprint 4.7). The translator maps this to the canonical `orders.order.<status>` type. */
export class OrderTransitioned extends DomainEvent {
  readonly eventName = "order.transitioned";
  readonly data: OrderTransitionedData;

  constructor(props: DomainEventProps, data: OrderTransitionedData) {
    super(props);
    this.data = data;
  }
}
