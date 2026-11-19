import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { AccessChanged, PreferencesUpdated, ThemePublished } from "../domain/events";

/** Beside the translator so `topic-inventory.test.ts` can pin it: each needs a Kafka topic. */
export const ONLINE_STORE_PUBLISHED_EVENTS: readonly string[] = [
  "online_store.theme.published",
  "online_store.access.changed",
  "online_store.preferences.updated",
];

export class OnlineStoreEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (
      event instanceof ThemePublished ||
      event instanceof AccessChanged ||
      event instanceof PreferencesUpdated
    ) {
      return {
        type: event.eventName,
        eventVersion: 1,
        aggregateType: "online_store",
        payload: event.data,
      };
    }
    return undefined;
  }
}
