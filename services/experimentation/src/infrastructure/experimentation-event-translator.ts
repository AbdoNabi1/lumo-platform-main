import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ExperimentTransitioned } from "../domain/events/experiment-transitioned.event";

/** Maps Experimentation domain events to integration events. `ExperimentTransitioned` maps dynamically to `experiment.<family>.<action>`. */
export class ExperimentationEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ExperimentTransitioned) {
      return {
        type: `experiment.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "experiment",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Experimentation context, 8 types across 3 families (Sprint 5.3). */
export const EXPERIMENTATION_PUBLISHED_EVENTS: readonly string[] = [
  "experiment.experiment.created",
  "experiment.experiment.started",
  "experiment.experiment.paused",
  "experiment.experiment.resumed",
  "experiment.experiment.completed",
  "experiment.experiment.archived",
  "experiment.result.recorded",
  "experiment.winner.declared",
];
