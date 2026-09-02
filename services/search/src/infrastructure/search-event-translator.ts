import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { IndexTransitioned } from "../domain/events/index-transitioned.event";

/** Maps Search domain events to integration events. `IndexTransitioned` maps dynamically to `search.<family>.<action>`. */
export class SearchEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof IndexTransitioned) {
      return {
        type: `search.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "search_index",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Search context, 9 types across 5 families (Sprint 5.2). */
export const SEARCH_PUBLISHED_EVENTS: readonly string[] = [
  "search.index.active",
  "search.index.rebuilding",
  "search.index.disabled",
  "search.document.upserted",
  "search.document.deleted",
  "search.synonyms.added",
  "search.synonyms.removed",
  "search.suggestion.added",
  "search.query.logged",
];
