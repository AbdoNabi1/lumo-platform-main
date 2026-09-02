import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { LoyaltyTransitioned } from "../domain/events/loyalty-transitioned.event";

/** Maps Loyalty domain events to integration events. `LoyaltyTransitioned` maps dynamically to `loyalty.<family>.<action>`. */
export class LoyaltyEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof LoyaltyTransitioned) {
      return {
        type: `loyalty.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "loyalty_account",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Loyalty context, 8 types across 5 families (Sprint 5.1). */
export const LOYALTY_PUBLISHED_EVENTS: readonly string[] = [
  "loyalty.account.opened",
  "loyalty.account.suspended",
  "loyalty.account.closed",
  "loyalty.points.earned",
  "loyalty.points.spent",
  "loyalty.tier.upgraded",
  "loyalty.reward.redeemed",
  "loyalty.referral.completed",
];
