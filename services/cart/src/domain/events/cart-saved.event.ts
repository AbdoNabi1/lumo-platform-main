import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CartSavedData {
  readonly customerRef?: string;
  readonly lineCount: number;
}

/** Raised when an active cart is set aside ("save for later"). */
export class CartSaved extends DomainEvent {
  readonly eventName = "cart.saved";
  readonly data: CartSavedData;

  constructor(props: DomainEventProps, data: CartSavedData) {
    super(props);
    this.data = data;
  }
}
