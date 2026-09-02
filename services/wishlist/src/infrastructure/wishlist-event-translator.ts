import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { WishlistTransitioned } from "../domain/events/wishlist-transitioned.event";

/** Maps Wishlist domain events to integration events. `WishlistTransitioned` maps dynamically to `wishlist.<family>.<action>`. */
export class WishlistEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof WishlistTransitioned) {
      return {
        type: `wishlist.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "wishlist",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/**
 * Published-event contract for the Wishlist context, 7 types across 2 families (Sprint 5.1).
 * `wishlist.wishlist.created` is a reserved contract entry (initial `active` state is set directly
 * by `create()`, never via `transition()`) — the same convention Notifications/Coupons established.
 */
export const WISHLIST_PUBLISHED_EVENTS: readonly string[] = [
  "wishlist.wishlist.created",
  "wishlist.wishlist.archived",
  "wishlist.wishlist.reactivated",
  "wishlist.item.added",
  "wishlist.item.removed",
  "wishlist.item.shared",
  "wishlist.item.moved_to_cart",
];
