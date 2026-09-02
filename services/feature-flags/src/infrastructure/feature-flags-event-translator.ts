import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { FlagTransitioned } from "../domain/events/flag-transitioned.event";

/** Maps Feature Flags domain events to integration events. `FlagTransitioned` maps dynamically to `feature_flags.flag.<action>`. */
export class FeatureFlagsEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof FlagTransitioned) {
      return {
        type: `feature_flags.flag.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "feature_flag",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/**
 * Published-event contract for the Feature Flags context, 6 types (Sprint 5.3). `feature_flags.
 * flag.created` is a reserved contract entry (initial `active` is set directly by `create()`, never
 * via `transition()`) — the same convention Notifications/Coupons/Wishlist/Reviews established.
 */
export const FEATURE_FLAGS_PUBLISHED_EVENTS: readonly string[] = [
  "feature_flags.flag.created",
  "feature_flags.flag.killed",
  "feature_flags.flag.revived",
  "feature_flags.flag.archived",
  "feature_flags.flag.rule_updated",
  "feature_flags.flag.rollout_changed",
];
