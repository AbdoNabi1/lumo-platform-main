import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface OrderPlacedData {
  readonly orderNumber: string;
  readonly customerRef: string;
  readonly currency: string;
  readonly totalAmountMinor: number;
  readonly lineCount: number;
}

/** Raised when an order is placed. */
export class OrderPlaced extends DomainEvent {
  readonly eventName = "order.placed";
  readonly data: OrderPlacedData;

  constructor(props: DomainEventProps, data: OrderPlacedData) {
    super(props);
    this.data = data;
  }
}
