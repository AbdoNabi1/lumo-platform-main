import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductMediaAttachedData {
  readonly assetId: string;
}

/** Raised when a media asset is attached to a product. */
export class ProductMediaAttached extends DomainEvent {
  readonly eventName = "product.media_attached";
  readonly data: ProductMediaAttachedData;

  constructor(props: DomainEventProps, data: ProductMediaAttachedData) {
    super(props);
    this.data = data;
  }
}
