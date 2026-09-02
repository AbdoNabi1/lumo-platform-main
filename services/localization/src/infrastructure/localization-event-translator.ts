import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { LocalizationTransitioned } from "../domain/events/localization-transitioned.event";

/** Maps Localization domain events to integration events. `LocalizationTransitioned` maps dynamically to `localization.<family>.<action>`. */
export class LocalizationEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof LocalizationTransitioned) {
      return {
        type: `localization.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: event.data.family,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Localization context (Sprint 5.4). */
export const LOCALIZATION_PUBLISHED_EVENTS: readonly string[] = [
  "localization.locale.activated",
  "localization.locale.deactivated",
  "localization.translation.set",
  "localization.translation.published",
  "localization.translation.removed",
];
