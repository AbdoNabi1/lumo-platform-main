import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductVariantUpdatedData {
  readonly variantId: string;
}

/** Raised when an existing variant's sku/price is edited in place (Sprint 7.0 `UpdateVariant`). */
export class ProductVariantUpdated extends DomainEvent {
  readonly eventName = "product.variant_updated";
  readonly data: ProductVariantUpdatedData;

  constructor(props: DomainEventProps, data: ProductVariantUpdatedData) {
    super(props);
    this.data = data;
  }
}
