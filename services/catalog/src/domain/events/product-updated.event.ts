import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductUpdatedData {
  readonly name: string;
  readonly slug: string;
}

/** Raised when a product's descriptive attributes change. */
export class ProductUpdated extends DomainEvent {
  readonly eventName = "product.updated";
  readonly data: ProductUpdatedData;

  constructor(props: DomainEventProps, data: ProductUpdatedData) {
    super(props);
    this.data = data;
  }
}
