import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { TenancyChanged } from "../domain/events/tenancy-changed.event";

/** Maps Tenancy domain events to integration events. `TenancyChanged` maps dynamically to `tenancy.<family>.<action>`. */
export class TenancyEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof TenancyChanged) {
      return {
        type: `tenancy.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: event.data.family,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Tenancy context (Sprint 5.5/5.6). */
export const TENANCY_PUBLISHED_EVENTS: readonly string[] = [
  "tenancy.tenant.created",
  "tenancy.tenant.activated",
  "tenancy.tenant.suspended",
  "tenancy.tenant.cancelled",
  "tenancy.tenant.rebranded",
  "tenancy.workspace.created",
  "tenancy.workspace.archived",
  "tenancy.workspace.configured",
];
