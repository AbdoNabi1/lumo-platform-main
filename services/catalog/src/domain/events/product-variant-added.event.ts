import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductVariantAddedData {
  readonly sku: string;
  readonly variantId: string;
  readonly variantSku: string;
}

/** Raised when a variant is added to the product's matrix. */
export class ProductVariantAdded extends DomainEvent {
  readonly eventName = "product.variant_added";
  readonly data: ProductVariantAddedData;

  constructor(props: DomainEventProps, data: ProductVariantAddedData) {
    super(props);
    this.data = data;
  }
}
