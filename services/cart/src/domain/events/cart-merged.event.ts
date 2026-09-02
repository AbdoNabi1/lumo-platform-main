import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CartMergedData {
  readonly sourceCartId: string;
  readonly customerRef: string;
  readonly lineCount: number;
}

/** Raised when a guest cart's lines are merged into a customer's cart. */
export class CartMerged extends DomainEvent {
  readonly eventName = "cart.merged";
  readonly data: CartMergedData;

  constructor(props: DomainEventProps, data: CartMergedData) {
    super(props);
    this.data = data;
  }
}
