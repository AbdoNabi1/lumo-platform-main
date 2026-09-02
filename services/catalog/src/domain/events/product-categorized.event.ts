import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductCategorizedData {
  readonly sku: string;
  readonly categoryIds: readonly string[];
}

/** Raised when a product's category assignments are set. */
export class ProductCategorized extends DomainEvent {
  readonly eventName = "product.categorized";
  readonly data: ProductCategorizedData;

  constructor(props: DomainEventProps, data: ProductCategorizedData) {
    super(props);
    this.data = data;
  }
}
