import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { LicensingChanged } from "../domain/events/licensing-changed.event";

/** Maps Licensing domain events to integration events. `LicensingChanged` maps dynamically to `licensing.<family>.<action>`. */
export class LicensingEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof LicensingChanged) {
      return {
        type: `licensing.${event.data.family}.${event.data.action}`,
        eventVersion: 1,
        aggregateType: event.data.family,
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Licensing context (Sprint 5.5/5.6). */
export const LICENSING_PUBLISHED_EVENTS: readonly string[] = [
  "licensing.plan.created",
  "licensing.plan.draft_created",
  "licensing.plan.version_scheduled",
  "licensing.plan.version_published",
  "licensing.plan.rolled_back",
  "licensing.plan.version_archived",
  "licensing.subscription.started",
  "licensing.subscription.activated",
  "licensing.subscription.repinned",
  "licensing.subscription.entered_grace",
  "licensing.subscription.expired",
  "licensing.subscription.suspended",
  "licensing.subscription.cancelled",
  "licensing.subscription.paused",
  "licensing.subscription.resumed",
  "licensing.merchant_feature_override.created",
  "licensing.merchant_feature_override.state_changed",
  "licensing.merchant_capabilities.created",
  "licensing.merchant_capabilities.granted",
  "licensing.merchant_capabilities.revoked",
  "licensing.usage_counter.created",
  "licensing.usage_counter.incremented",
  "licensing.credit.granted",
  "licensing.credit.consumed",
  "licensing.credit.expired",
  "licensing.invoice.created",
  "licensing.invoice.issued",
  "licensing.invoice.paid",
  "licensing.invoice.failed",
  "licensing.invoice.voided",
];
