import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { SeoChanged } from "../domain/events/seo-changed.event";

/** Maps SEO domain events to integration events. `SeoChanged` maps dynamically to `seo.<entityType>.<action>`. */
export class SeoEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof SeoChanged) {
      return {
        type: `seo.${event.data.entityType}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: event.data.entityType,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the SEO context (Sprint 5.4). */
export const SEO_PUBLISHED_EVENTS: readonly string[] = [
  "seo.profile.created",
  "seo.profile.updated",
  "seo.redirect.created",
  "seo.redirect.updated",
  "seo.sitemap.created",
  "seo.sitemap.updated",
  "seo.robots_policy.created",
  "seo.robots_policy.updated",
];
