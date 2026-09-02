import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ExampleRegistered } from "../domain/example-registered.event";

/**
 * Maps the service's domain events to integration events (keeps `@platform/domain` pure — no
 * `toIntegrationEvent()` on the event). Reference only.
 */
export class ExampleEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ExampleRegistered) {
      return {
        type: "example.example.registered",
        eventVersion: 1,
        aggregateType: "example",
        payload: { label: event.label },
      };
    }
    return undefined;
  }
}
