import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ProductMediaDetachedData {
  readonly assetId: string;
}

/** Raised when a media asset is detached from a product. */
export class ProductMediaDetached extends DomainEvent {
  readonly eventName = "product.media_detached";
  readonly data: ProductMediaDetachedData;

  constructor(props: DomainEventProps, data: ProductMediaDetachedData) {
    super(props);
    this.data = data;
  }
}
