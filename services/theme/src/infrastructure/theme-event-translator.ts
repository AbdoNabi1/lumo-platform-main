import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ThemeTransitioned } from "../domain/events/theme-transitioned.event";

/** Maps Theme domain events to integration events. `ThemeTransitioned` maps dynamically to `theme.theme.<action>`. */
export class ThemeEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ThemeTransitioned) {
      return {
        type: `theme.theme.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "theme",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Theme context (Sprint 5.4). */
export const THEME_PUBLISHED_EVENTS: readonly string[] = [
  "theme.theme.draft",
  "theme.theme.active",
  "theme.theme.archived",
];
