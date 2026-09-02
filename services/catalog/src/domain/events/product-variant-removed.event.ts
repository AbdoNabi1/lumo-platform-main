import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductVariantRemovedData {
  readonly sku: string;
  readonly variantId: string;
}

/** Raised when a variant is removed from the product's matrix. */
export class ProductVariantRemoved extends DomainEvent {
  readonly eventName = "product.variant_removed";
  readonly data: ProductVariantRemovedData;

  constructor(props: DomainEventProps, data: ProductVariantRemovedData) {
    super(props);
    this.data = data;
  }
}
