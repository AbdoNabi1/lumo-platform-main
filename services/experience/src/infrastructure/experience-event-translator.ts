import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ExperienceTransitioned } from "../domain/events/experience-transitioned.event";

/** Maps Experience domain events to integration events. `ExperienceTransitioned` maps dynamically to `experience.experience.<action>`. */
export class ExperienceEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ExperienceTransitioned) {
      return {
        type: `experience.experience.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "experience",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Experience context (Sprint 5.4). */
export const EXPERIENCE_PUBLISHED_EVENTS: readonly string[] = [
  "experience.experience.draft",
  "experience.experience.published",
  "experience.experience.archived",
];
