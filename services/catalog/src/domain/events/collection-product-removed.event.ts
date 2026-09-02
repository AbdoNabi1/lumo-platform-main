import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CollectionProductRemovedData {
  readonly productId: string;
}

/** Raised when a product is removed from a collection. */
export class CollectionProductRemoved extends DomainEvent {
  readonly eventName = "collection.product_removed";
  readonly data: CollectionProductRemovedData;

  constructor(props: DomainEventProps, data: CollectionProductRemovedData) {
    super(props);
    this.data = data;
  }
}
