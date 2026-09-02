import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ContentTransitioned } from "../domain/events/content-transitioned.event";

/** Maps Content domain events to integration events. `ContentTransitioned` maps dynamically to `content.content_block.<action>`. */
export class ContentEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ContentTransitioned) {
      return {
        type: `content.content_block.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "content_block",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Content context (Sprint 5.4). */
export const CONTENT_PUBLISHED_EVENTS: readonly string[] = [
  "content.content_block.draft",
  "content.content_block.scheduled",
  "content.content_block.published",
  "content.content_block.archived",
];
