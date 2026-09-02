import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { PromotionTransitioned } from "../domain/events/promotion-transitioned.event";

/** Maps Promotions domain events to integration events. `PromotionTransitioned` maps dynamically to its canonical `promotions.promotion.<status>` type. */
export class PromotionsEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof PromotionTransitioned) {
      return {
        type: `promotions.promotion.${event.data.toStatus}`,
        eventVersion: 1,
        aggregateType: "promotion",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Promotions context, 8 types — one per `PromotionStatusValue`. */
export const PROMOTIONS_PUBLISHED_EVENTS: readonly string[] = [
  "promotions.promotion.draft",
  "promotions.promotion.scheduled",
  "promotions.promotion.active",
  "promotions.promotion.paused",
  "promotions.promotion.expired",
  "promotions.promotion.depleted",
  "promotions.promotion.cancelled",
  "promotions.promotion.archived",
];
