import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { NotificationTransitioned } from "../domain/events/notification-transitioned.event";

/** Maps Notifications domain events to integration events. `NotificationTransitioned` maps dynamically to its canonical `notifications.notification.<status>` type — a uniform mapping, like Fulfillment (not the multi-prefix taxonomy Shipping/Returns needed). */
export class NotificationsEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (event instanceof NotificationTransitioned) {
      return {
        type: `notifications.notification.${event.data.toStatus}`,
        eventVersion: 1,
        aggregateType: "notification",
        payload: event.data,
      };
    }
    return undefined;
  }
}

/** Published-event contract for the Notifications context (validated fail-closed by `notificationsModule()`), 9 types — one per `NotificationStatusValue`. */
export const NOTIFICATIONS_PUBLISHED_EVENTS: readonly string[] = [
  "notifications.notification.created",
  "notifications.notification.queued",
  "notifications.notification.sent",
  "notifications.notification.delivered",
  "notifications.notification.failed",
  "notifications.notification.retrying",
  "notifications.notification.dead_letter",
  "notifications.notification.cancelled",
  "notifications.notification.expired",
];
