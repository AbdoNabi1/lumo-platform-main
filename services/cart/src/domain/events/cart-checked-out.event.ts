import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CartCheckedOutData {
  readonly customerRef: string;
  readonly currency: string;
  readonly totalAmountMinor: number;
  readonly lineCount: number;
}

/** Raised when a cart is checked out — the signal the checkout saga (Sprint 1.4) consumes. */
export class CartCheckedOut extends DomainEvent {
  readonly eventName = "cart.checked_out";
  readonly data: CartCheckedOutData;

  constructor(props: DomainEventProps, data: CartCheckedOutData) {
    super(props);
    this.data = data;
  }
}
