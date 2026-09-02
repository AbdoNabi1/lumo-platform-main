import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CartLockedData {
  readonly customerRef?: string;
}

/** Raised when a cart is locked (e.g. while checkout is in progress) — blocks further modification. */
export class CartLocked extends DomainEvent {
  readonly eventName = "cart.locked";
  readonly data: CartLockedData;

  constructor(props: DomainEventProps, data: CartLockedData) {
    super(props);
    this.data = data;
  }
}
