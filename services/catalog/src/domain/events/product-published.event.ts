import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductPublishedData {
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
}

/** Raised when a product transitions to published. Consumed downstream (search, feed) later. */
export class ProductPublished extends DomainEvent {
  readonly eventName = "product.published";
  readonly data: ProductPublishedData;

  constructor(props: DomainEventProps, data: ProductPublishedData) {
    super(props);
    this.data = data;
  }
}
