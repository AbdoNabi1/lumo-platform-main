import { Entity, type UniqueEntityId } from "@platform/domain";
import type { NotificationStatusValue } from "./value-objects/notification-status";

interface NotificationEventProps {
  readonly status: NotificationStatusValue;
  readonly occurredAt: Date;
}

/** An append-only log entry for a lifecycle-status change (the notification's own history; never rewritten). */
export class NotificationEvent extends Entity<NotificationEventProps> {
  static create(
    id: UniqueEntityId,
    status: NotificationStatusValue,
    occurredAt: Date,
  ): NotificationEvent {
    return new NotificationEvent({ status, occurredAt }, id);
  }

  get status(): NotificationStatusValue {
    return this.props.status;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
