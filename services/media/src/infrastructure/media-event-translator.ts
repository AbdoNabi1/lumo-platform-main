import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { MediaAssetReady } from "../domain/events/media-asset-ready.event";

/** Maps Media domain events to integration events. */
export class MediaEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof MediaAssetReady) {
      return {
        type: "media.asset.ready",
        eventVersion: 1,
        aggregateType: "asset",
        payload: event.data,
      };
    }
    return undefined;
  }
}
