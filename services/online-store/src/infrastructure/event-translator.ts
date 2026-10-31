import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { AccessChanged, PreferencesUpdated, ThemePublished } from "../domain/events";

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
