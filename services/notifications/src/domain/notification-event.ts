import { Entity, type UniqueEntityId } from "@platform/domain";
import type { NotificationStatusValue } from "./value-objects/notification-status";

interface NotificationEventProps {
  readonly status: NotificationStatusValue;
  readonly occurredAt: Date;
  /** A short machine code (never free text, never an address) for why: `DISABLED`, `EMAIL_NOT_CONFIGURED`... */
  readonly reason?: string;
}

/** An append-only log entry for a lifecycle-status change (the notification's own history; never rewritten). */
export class NotificationEvent extends Entity<NotificationEventProps> {
  static create(
    id: UniqueEntityId,
    status: NotificationStatusValue,
    occurredAt: Date,
    reason?: string,
  ): NotificationEvent {
    return new NotificationEvent(
      { status, occurredAt, ...(reason === undefined ? {} : { reason }) },
      id,
    );
  }

  get reason(): string | undefined {
    return this.props.reason;
  }

  get status(): NotificationStatusValue {
    return this.props.status;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }
}
