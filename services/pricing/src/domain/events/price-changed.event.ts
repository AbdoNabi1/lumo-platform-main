import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface PriceChangedData {
  readonly priceListId: string;
  readonly productId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly compareAtMinor?: number;
  readonly costMinor?: number;
}

/** Raised when a price's amount changes. Consumed downstream (feeds, cart pricing) later. */
export class PriceChanged extends DomainEvent {
  readonly eventName = "price.changed";
  readonly data: PriceChangedData;

  constructor(props: DomainEventProps, data: PriceChangedData) {
    super(props);
    this.data = data;
  }
}
