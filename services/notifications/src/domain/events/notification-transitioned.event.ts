import { DomainEvent, type DomainEventProps } from "@platform/domain";
import type { NotificationStatusValue } from "../value-objects/notification-status";

export interface NotificationTransitionedData {
  readonly sourceRef: string;
  readonly fromStatus: NotificationStatusValue;
  readonly toStatus: NotificationStatusValue;
}

/** Raised on every validated lifecycle transition (Sprint 4.12). The translator maps this to `notifications.notification.<status>`. */
export class NotificationTransitioned extends DomainEvent {
  readonly eventName = "notification.transitioned";
  readonly data: NotificationTransitionedData;

  constructor(props: DomainEventProps, data: NotificationTransitionedData) {
    super(props);
    this.data = data;
  }
}
