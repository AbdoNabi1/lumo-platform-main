import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ComponentTransitioned } from "../domain/events/component-transitioned.event";

/** Maps Components domain events to integration events. `ComponentTransitioned` maps dynamically to `components.component_definition.<action>`. */
export class ComponentsEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ComponentTransitioned) {
      return {
        type: `components.component_definition.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "component_definition",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Components context (Sprint 5.4). */
export const COMPONENTS_PUBLISHED_EVENTS: readonly string[] = [
  "components.component_definition.draft",
  "components.component_definition.published",
  "components.component_definition.deprecated",
  "components.component_definition.archived",
];
