import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ReportingTransitioned } from "../domain/events/reporting-transitioned.event";

/** Maps Reporting domain events to integration events. `ReportingTransitioned` maps dynamically to `reporting.<family>.<action>`. */
export class ReportingEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ReportingTransitioned) {
      return {
        type: `reporting.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: event.data.family,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Reporting context, 8 types across 3 families (Sprint 5.3). */
export const REPORTING_PUBLISHED_EVENTS: readonly string[] = [
  "reporting.report_definition.created",
  "reporting.report_definition.active",
  "reporting.report_definition.archived",
  "reporting.dashboard.created",
  "reporting.dashboard.archived",
  "reporting.dashboard.reactivated",
  "reporting.report.generated",
  "reporting.report.failed",
];
