import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductArchivedData {
  readonly sku: string;
}

/** Raised when a product is archived (terminal state). */
export class ProductArchived extends DomainEvent {
  readonly eventName = "product.archived";
  readonly data: ProductArchivedData;

  constructor(props: DomainEventProps, data: ProductArchivedData) {
    super(props);
    this.data = data;
  }
}
