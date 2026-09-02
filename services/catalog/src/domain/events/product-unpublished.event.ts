import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductUnpublishedData {
  readonly sku: string;
}

/** Raised when a published product is unpublished (back to draft). */
export class ProductUnpublished extends DomainEvent {
  readonly eventName = "product.unpublished";
  readonly data: ProductUnpublishedData;

  constructor(props: DomainEventProps, data: ProductUnpublishedData) {
    super(props);
    this.data = data;
  }
}
