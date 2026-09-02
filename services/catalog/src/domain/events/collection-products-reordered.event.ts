import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CollectionProductsReorderedData {
  readonly productIds: readonly string[];
}

/** Raised when a collection's product display order is changed. */
export class CollectionProductsReordered extends DomainEvent {
  readonly eventName = "collection.products_reordered";
  readonly data: CollectionProductsReorderedData;

  constructor(props: DomainEventProps, data: CollectionProductsReorderedData) {
    super(props);
    this.data = data;
  }
}
