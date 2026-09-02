import { DomainEvent, type DomainEventProps } from "@platform/domain";

export type WishlistEventFamily = "wishlist" | "item";

export interface WishlistTransitionedData {
  readonly customerRef: string;
  readonly family: WishlistEventFamily;
  readonly action: string;
  readonly productRef?: string;
}

/**
 * Raised on every wishlist/item state change (Sprint 5.1) — a two-dimensional `(family, action)`
 * pair, generalizing the single-dimension dynamic-status-mapping technique Notifications/Promotions
 * use, because the report's own event naming (`wishlist.wishlist/item.*`) already carries two
 * segments after the context prefix. The translator maps this to `wishlist.<family>.<action>`.
 */
export class WishlistTransitioned extends DomainEvent {
  readonly eventName = "wishlist.transitioned";
  readonly data: WishlistTransitionedData;

  constructor(props: DomainEventProps, data: WishlistTransitionedData) {
    super(props);
    this.data = data;
  }
}
