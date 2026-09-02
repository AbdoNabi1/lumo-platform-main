import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { MediaLibraryChanged } from "../domain/events/media-library-changed.event";

/** Maps Media Library domain events to integration events. `MediaLibraryChanged` maps dynamically to `media.<entityType>.<action>`. */
export class MediaLibraryEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof MediaLibraryChanged) {
      return {
        type: `media.${event.data.entityType}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: event.data.entityType,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Media Library extension (Sprint 5.4). */
export const MEDIA_LIBRARY_PUBLISHED_EVENTS: readonly string[] = [
  "media.folder.created",
  "media.folder.archived",
  "media.media_asset.created",
  "media.media_asset.archived",
];
