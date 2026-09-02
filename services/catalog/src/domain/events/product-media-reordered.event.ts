import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductMediaReorderedData {
  readonly assetIds: readonly string[];
}

/** Raised when a product's media display order is changed. */
export class ProductMediaReordered extends DomainEvent {
  readonly eventName = "product.media_reordered";
  readonly data: ProductMediaReorderedData;

  constructor(props: DomainEventProps, data: ProductMediaReorderedData) {
    super(props);
    this.data = data;
  }
}
