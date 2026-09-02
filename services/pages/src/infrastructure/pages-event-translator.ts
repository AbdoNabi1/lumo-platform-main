import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { PagesTransitioned } from "../domain/events/pages-transitioned.event";

/** Maps Pages domain events to integration events. `PagesTransitioned` maps dynamically to `pages.<family>.<action>`. */
export class PagesEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof PagesTransitioned) {
      return {
        type: `pages.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: event.data.family,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Pages context (Sprint 5.4). */
export const PAGES_PUBLISHED_EVENTS: readonly string[] = [
  "pages.page.published",
  "pages.page.archived",
  "pages.template.archived",
];
