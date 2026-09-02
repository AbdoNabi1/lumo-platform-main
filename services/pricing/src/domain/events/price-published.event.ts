import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface PricePublishedData {
  readonly priceListId: string;
  readonly productId: string;
}

/** Raised when a draft price is published. */
export class PricePublished extends DomainEvent {
  readonly eventName = "price.published";
  readonly data: PricePublishedData;

  constructor(props: DomainEventProps, data: PricePublishedData) {
    super(props);
    this.data = data;
  }
}
