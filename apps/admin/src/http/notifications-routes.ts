import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import type { Notification } from "@platform/notifications";
import type { WiredAdmin } from "../composition";
import { mapPage } from "./public-catalog-routes";

const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});

export interface NotificationDeliveryAttemptDto {
  readonly channel: string;
  readonly outcome: string;
  readonly providerRef: string | null;
  readonly occurredAt: string;
}

export interface NotificationEventDto {
  readonly status: string;
  readonly occurredAt: string;
}

export interface NotificationDto {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly sourceRef: string;
  readonly recipientRef: string;
  readonly channels: readonly string[];
  readonly currentChannel: string;
  readonly templateId: string;
  readonly status: string;
  readonly attempts: readonly NotificationDeliveryAttemptDto[];
  readonly history: readonly NotificationEventDto[];
  readonly deliveredAt: string | null;
}

function toNotificationDto(notification: Notification): NotificationDto {
  return {
    id: notification.id.toString(),
    idempotencyKey: notification.idempotencyKey,
    sourceRef: notification.sourceRef,
    recipientRef: notification.recipient.customerRef,
    channels: notification.channels.map((c) => c.value),
    currentChannel: notification.currentChannel.value,
    templateId: notification.template.templateId,
    status: notification.status.value,
    attempts: notification.attempts.map((a) => ({
      channel: a.channel,
      outcome: a.outcome,
      providerRef: a.providerRef ?? null,
      occurredAt: a.occurredAt.toISOString(),
    })),
    history: notification.history.map((h) => ({
      status: h.status,
      occurredAt: h.occurredAt.toISOString(),
    })),
    deliveredAt: notification.deliveredAt?.toISOString() ?? null,
  };
}

const createNotificationBody = z.object({
  idempotencyKey: z.string().min(1),
  sourceRef: z.string().min(1),
  recipientRef: z.string().min(1),
  channels: z.array(z.string().min(1)).min(1),
  templateId: z.string().min(1),
  bodyPattern: z.string().min(1),
  subjectPattern: z.string().min(1).optional(),
  variables: z.record(z.string()),
  maxAttempts: z.number().int().positive(),
  expiresAt: z.coerce.date().optional(),
});
const notificationIdParams = z.object({ notificationId: z.string().min(1) });
const advanceBody = z.object({ toStatus: z.string().min(1) });
const callbackBody = z.object({
  provider: z.string().min(1),
  callbackId: z.string().min(1),
  kind: z.string().min(1),
});

/**
 * The Notifications admin HTTP surface (Sprint 4.12 — Notifications' first HTTP transport, per
 * `SPRINT_4_12_NOTIFICATIONS_CORE_REPORT.md` §2: "NotificationsController +
 * NotificationsAdminController + notifications-routes (6 versioned zod routes under
 * /notifications: create / queue / send / retry / transitions / callback)"). Pure delegation —
 * zod validates the boundary, the facade authorizes + audits (AdminGuard), the context owns all
 * behavior.
 */
export function notificationsRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "POST",
      path: "/notifications",
      version: 1,
      permission: "notifications:create",
      idempotent: true,
      summary: "Open a notification for delivery (idempotent by idempotencyKey)",
      schema: { body: createNotificationBody },
      handle: ({ body, context }) => admin.notifications.create(context.principal, body),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/:notificationId/queue",
      version: 1,
      permission: "notifications:queue",
      idempotent: true,
      summary: "Queue a created notification for delivery",
      schema: { params: notificationIdParams },
      handle: ({ params, context }) => admin.notifications.queue(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/:notificationId/send",
      version: 1,
      permission: "notifications:send",
      summary: "Send via the notification's current channel's provider port",
      schema: { params: notificationIdParams },
      handle: ({ params, context }) => admin.notifications.send(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/:notificationId/retry",
      version: 1,
      permission: "notifications:retry",
      idempotent: true,
      summary: "Retry a failed notification per its delivery policy",
      schema: { params: notificationIdParams },
      handle: ({ params, context }) => admin.notifications.retry(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/:notificationId/transitions",
      version: 1,
      permission: "notifications:advance",
      idempotent: true,
      summary: "Advance a notification to any status its current status's transition table allows",
      schema: { params: notificationIdParams, body: advanceBody },
      handle: ({ params, body, context }) =>
        admin.notifications.advance(context.principal, {
          notificationId: params.notificationId,
          toStatus: body.toStatus as Parameters<typeof admin.notifications.advance>[1]["toStatus"],
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/notifications/:notificationId/callback",
      version: 1,
      permission: "notifications:callback",
      summary: "Record a provider callback (replay-safe)",
      schema: { params: notificationIdParams, body: callbackBody },
      handle: ({ params, body, context }) =>
        admin.notifications.callback(context.principal, {
          notificationId: params.notificationId,
          ...body,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/notifications",
      version: 1,
      permission: "notifications:read",
      summary: "List notifications (cursor pagination)",
      schema: { querystring: pageQuery },
      handle: async ({ query, context }) =>
        mapPage(await admin.notifications.list(context.principal, query), toNotificationDto),
    }),
    defineRoute({
      method: "GET",
      path: "/notifications/:notificationId",
      version: 1,
      permission: "notifications:read",
      summary: "Get one notification by id",
      schema: { params: notificationIdParams },
      handle: async ({ params, context }) => {
        const response = await admin.notifications.get(context.principal, params);
        if (response.status !== 200) return response;
        return { status: 200, body: toNotificationDto(response.body as Notification) };
      },
    }),
  ] as readonly RouteDefinition[];
}
