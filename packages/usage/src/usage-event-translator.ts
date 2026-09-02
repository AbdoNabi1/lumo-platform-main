import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { UsageRecorded } from "./usage-recorded.event";

/** Maps the generic {@link UsageRecorded} domain event to the canonical `platform.usage.recorded` integration event. */
export class UsageEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof UsageRecorded) {
      return {
        type: "platform.usage.recorded",
        eventVersion: 1,
        aggregateType: "usage",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** The single canonical usage event (runtime-verified anywhere it is published/consumed). */
export const PLATFORM_USAGE_PUBLISHED_EVENTS = ["platform.usage.recorded"] as const;
