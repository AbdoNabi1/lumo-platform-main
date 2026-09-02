import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { WorkflowTransitioned } from "../domain/events/workflow-transitioned.event";

/** Maps Automation domain events to integration events. `WorkflowTransitioned` maps dynamically to `automation.<family>.<action>`. */
export class AutomationEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof WorkflowTransitioned) {
      return {
        type: `automation.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: "automation_workflow",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Automation context, 9 types across 2 families (Sprint 5.3). */
export const AUTOMATION_PUBLISHED_EVENTS: readonly string[] = [
  "automation.workflow.created",
  "automation.workflow.active",
  "automation.workflow.paused",
  "automation.workflow.archived",
  "automation.execution.running",
  "automation.execution.succeeded",
  "automation.execution.failed",
  "automation.execution.retrying",
  "automation.execution.dead_letter",
];
