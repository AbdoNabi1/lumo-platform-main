import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CartAbandonedData {
  readonly customerRef: string;
  readonly lineCount: number;
}

/** Raised when an active cart is abandoned (consumer — marketing/recovery — deferred). */
export class CartAbandoned extends DomainEvent {
  readonly eventName = "cart.abandoned";
  readonly data: CartAbandonedData;

  constructor(props: DomainEventProps, data: CartAbandonedData) {
    super(props);
    this.data = data;
  }
}
