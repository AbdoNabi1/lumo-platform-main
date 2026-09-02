import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { ReturnTransitioned } from "../domain/events/return-transitioned.event";

/** Maps Returns domain events to integration events. `ReturnTransitioned` carries its own canonical type (spanning `request`/`package`/`inspection`/`items`/`refund`/`replacement`/`repair` prefixes) — this translator is a pure pass-through, not a deriver. */
export class ReturnsEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof ReturnTransitioned) {
      return {
        type: event.data.type,
        eventVersion: 1,
        aggregateType: "return_request",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Returns context (validated fail-closed by `returnsModule()`), 12 types across the `request`/`package`/`inspection`/`items`/`refund`/`replacement`/`repair` prefixes. */
export const RETURNS_PUBLISHED_EVENTS: readonly string[] = [
  "returns.request.requested",
  "returns.request.approved",
  "returns.request.rejected",
  "returns.request.closed",
  "returns.package.rma_generated",
  "returns.package.received",
  "returns.inspection.completed",
  "returns.items.accepted",
  "returns.items.rejected",
  "returns.refund.requested",
  "returns.replacement.requested",
  "returns.repair.requested",
];
