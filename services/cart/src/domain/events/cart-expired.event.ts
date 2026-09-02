import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CartExpiredData {
  readonly customerRef?: string;
  readonly previousStatus: string;
}

/** Raised when a cart is expired (TTL sweep or explicit command). */
export class CartExpired extends DomainEvent {
  readonly eventName = "cart.expired";
  readonly data: CartExpiredData;

  constructor(props: DomainEventProps, data: CartExpiredData) {
    super(props);
    this.data = data;
  }
}
