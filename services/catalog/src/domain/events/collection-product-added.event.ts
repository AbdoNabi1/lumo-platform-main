import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CollectionProductAddedData {
  readonly productId: string;
}

/** Raised when a product is added to a collection. */
export class CollectionProductAdded extends DomainEvent {
  readonly eventName = "collection.product_added";
  readonly data: CollectionProductAddedData;

  constructor(props: DomainEventProps, data: CollectionProductAddedData) {
    super(props);
    this.data = data;
  }
}
