import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ModelTransitioned } from "../domain/events/model-transitioned.event";

/** Maps Recommendations domain events to integration events. `ModelTransitioned` maps dynamically to `recommendations.<family>.<action>`. */
export class RecommendationsEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ModelTransitioned) {
      return {
        type: `recommendations.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "recommendation_model",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Recommendations context, 6 types across 2 families (Sprint 5.2). */
export const RECOMMENDATIONS_PUBLISHED_EVENTS: readonly string[] = [
  "recommendations.model.draft",
  "recommendations.model.training",
  "recommendations.model.active",
  "recommendations.model.retired",
  "recommendations.set.generated",
  "recommendations.set.regenerated",
];
