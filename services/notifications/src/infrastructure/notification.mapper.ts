import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { UnexpectedError } from "@platform/utils";
import { DeliveryAttempt, type DeliveryAttemptOutcome } from "../domain/delivery-attempt";
import { Notification } from "../domain/notification";
import { NotificationEvent } from "../domain/notification-event";
import { DeliveryPolicy } from "../domain/value-objects/delivery-policy";
import { NotificationChannel } from "../domain/value-objects/notification-channel";
import { NotificationTemplate } from "../domain/value-objects/notification-template";
import {
  NotificationStatus,
  type NotificationStatusValue,
} from "../domain/value-objects/notification-status";
import { Recipient } from "../domain/value-objects/recipient";

export interface RecipientJson {
  readonly customerRef: string;
}
export interface TemplateJson {
  readonly templateId: string;
  readonly bodyPattern: string;
  readonly subjectPattern?: string;
}
export interface PolicyJson {
  readonly maxAttempts: number;
  readonly expiresAt?: string;
}
export interface DeliveryAttemptJson {
  readonly id: string;
  readonly channel: string;
  readonly outcome: DeliveryAttemptOutcome;
  readonly providerRef?: string;
  readonly occurredAt: string;
}
export interface NotificationEventJson {
  readonly id: string;
  readonly status: NotificationStatusValue;
  readonly occurredAt: string;
}

export interface NotificationRow {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly sourceRef: string;
  readonly recipient: RecipientJson;
  readonly channels: readonly string[];
  readonly channelIndex: number;
  readonly template: TemplateJson;
  readonly variables: Readonly<Record<string, string>>;
  readonly policy: PolicyJson;
  readonly status: string;
  readonly attempts: readonly DeliveryAttemptJson[];
  readonly history: readonly NotificationEventJson[];
  readonly deliveredAt: Date | null;
  readonly version: number;
}

function must<T>(result: Result<T, { message: string }>, what: string): T {
  if (!result.ok) {
    throw new UnexpectedError(
      `Corrupt notification row: invalid ${what} (${result.error.message})`,
    );
  }
  return result.value;
}

/** Persistence ↔ aggregate mapping for {@link Notification}. Mapping only — no I/O. Unlike every prior context, attempts/history are embedded JSONB arrays on the row itself (no separate child table). */
export class NotificationMapper {
  static toDomain(row: NotificationRow): Notification {
    return Notification.reconstitute(
      UniqueEntityId.from(row.id),
      row.idempotencyKey,
      row.sourceRef,
      must(Recipient.create(row.recipient.customerRef), "recipient"),
      row.channels.map((c) => must(NotificationChannel.create(c), "channel")),
      row.channelIndex,
      must(
        NotificationTemplate.create(
          row.template.templateId,
          row.template.bodyPattern,
          row.template.subjectPattern,
        ),
        "template",
      ),
      row.variables,
      DeliveryPolicy.create(
        row.policy.maxAttempts,
        row.policy.expiresAt === undefined ? undefined : new Date(row.policy.expiresAt),
      ),
      NotificationStatus.from(row.status as NotificationStatusValue),
      row.version,
      {
        attempts: row.attempts.map((a) =>
          DeliveryAttempt.create(
            UniqueEntityId.from(a.id),
            a.channel,
            a.outcome,
            new Date(a.occurredAt),
            a.providerRef,
          ),
        ),
        history: row.history.map((h) =>
          NotificationEvent.create(UniqueEntityId.from(h.id), h.status, new Date(h.occurredAt)),
        ),
        deliveredAt: row.deliveredAt ?? undefined,
      },
    );
  }

  static toRow(notification: Notification, tenantId: string) {
    return {
      id: notification.id.toString(),
      tenantId,
      idempotencyKey: notification.idempotencyKey,
      sourceRef: notification.sourceRef,
      recipient: { customerRef: notification.recipient.customerRef },
      channels: notification.channels.map((c) => c.value),
      channelIndex: notification.channelIndex,
      template: {
        templateId: notification.template.templateId,
        bodyPattern: notification.template.bodyPattern,
        subjectPattern: notification.template.subjectPattern,
      },
      variables: notification.variables,
      policy: {
        maxAttempts: notification.policy.maxAttempts,
        expiresAt: notification.policy.expiresAt?.toISOString(),
      },
      status: notification.status.value,
      attempts: notification.attempts.map((a) => ({
        id: a.id.toString(),
        channel: a.channel,
        outcome: a.outcome,
        providerRef: a.providerRef,
        occurredAt: a.occurredAt.toISOString(),
      })),
      history: notification.history.map((h) => ({
        id: h.id.toString(),
        status: h.status,
        occurredAt: h.occurredAt.toISOString(),
      })),
      deliveredAt: notification.deliveredAt ?? null,
      version: 1,
    };
  }
}
