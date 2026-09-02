import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ReviewTransitioned } from "../domain/events/review-transitioned.event";

/** Maps Reviews domain events to integration events. `ReviewTransitioned` maps dynamically to `reviews.review.<action>`. */
export class ReviewsEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ReviewTransitioned) {
      return {
        type: `reviews.review.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "review",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/**
 * Published-event contract for the Reviews context, 8 types (Sprint 5.2). `reviews.review.created`
 * is a reserved contract entry (initial `pending` is set directly by `create()`, never via
 * `transition()`) — the same convention Notifications/Coupons/Wishlist established.
 */
export const REVIEWS_PUBLISHED_EVENTS: readonly string[] = [
  "reviews.review.created",
  "reviews.review.published",
  "reviews.review.rejected",
  "reviews.review.flagged",
  "reviews.review.removed",
  "reviews.review.voted",
  "reviews.review.reported",
  "reviews.review.responded",
];
