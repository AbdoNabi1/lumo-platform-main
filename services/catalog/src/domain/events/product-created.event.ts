import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductCreatedData {
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
}

/** Raised when a draft product is created. */
export class ProductCreated extends DomainEvent {
  readonly eventName = "product.created";
  readonly data: ProductCreatedData;

  constructor(props: DomainEventProps, data: ProductCreatedData) {
    super(props);
    this.data = data;
  }
}
