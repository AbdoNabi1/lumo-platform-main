import type { NotificationsController } from "@platform/notifications";
import type { NotificationPort } from "@platform/payments";

interface CreateNotificationBody {
  readonly notificationId: string;
}

/**
 * Real `NotificationPort` over Notifications' own create -> queue -> send lifecycle (Phase 3 Task
 * 13, C-3) — Payments' lifecycle use cases call this instead of the offline
 * `InMemoryNotificationAdapter` stub (`services/payments/src/infrastructure/in-memory-port-
 * adapters.ts`), which was a pure no-op. Near-identical in shape to `OrdersNotificationAdapter`
 * (`orders-notification.adapter.ts`, Task 12a), which solves the exact same create -> queue -> send
 * problem for Orders — the 3-step sequence is Notifications' own real caller contract, not
 * invented here.
 *
 * `NotificationPort` here is `notify(orderRef, status)` — Payments only knows `orderRef`, not a
 * separate customer reference the way Orders' port does. `recipientRef` uses `orderRef` as the
 * best available reference rather than adding a second `OrderController` dependency here just to
 * resolve a `customerRef` for a best-effort, may-be-dropped-entirely notification — that would be
 * scope creep for a port whose own contract says it may be dropped without consequence, and this
 * adapter deliberately stays self-contained rather than sharing a lookup with
 * `PaymentsOrdersAdapter` (a little duplication between two small, independent adapters is fine
 * and matches this phase's existing pattern).
 *
 * Deliberately minimal, generic glue content, matching Task 12a's posture exactly:
 *  - `channels`: a single default, `["email"]` — no multi-channel selection logic.
 *  - `templateId`/`bodyPattern`/`subjectPattern`: a generic "payment status changed" message; the
 *    order reference/status are interpolated via `variables`, not baked into the pattern strings.
 *  - `maxAttempts`: 3 — same deliberately small, defensible constant as Task 12a (Notifications'
 *    own `DeliveryPolicy` documents no house default).
 *  - `idempotencyKey`: `${orderRef}:${status}`, not a freshly generated id per call — `notify()`
 *    may be invoked more than once for the SAME logical transition (e.g. a settle retry), and
 *    `CreateNotification` is itself idempotent by `idempotencyKey` (a replay returns the
 *    already-created notification rather than a duplicate) — a fresh id per call would defeat that
 *    and mint a new notification on every retry.
 *  - `sourceRef`: `payments:${orderRef}` — identifies this as payments-lifecycle-sourced.
 *
 * Failure handling: `notify()`'s one caller, `notifyBestEffort`
 * (`services/payments/src/application/payment-lifecycle.use-cases.ts`), already wraps every call
 * in a swallowing try/catch — "a reference-only notification failure never fails the intent's own
 * transition." So this adapter does no internal error handling of its own: a failure from any of
 * the 3 steps propagates straight out and is swallowed by the caller, exactly as designed.
 */
export class PaymentsNotificationAdapter implements NotificationPort {
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;

  private readonly notifications: Pick<NotificationsController, "create" | "queue" | "send">;

  constructor(notifications: Pick<NotificationsController, "create" | "queue" | "send">) {
    this.notifications = notifications;
  }

  async notify(orderRef: string, status: string): Promise<void> {
    const idempotencyKey = `${orderRef}:${status}`;

    const createResponse = await this.notifications.create({
      idempotencyKey,
      sourceRef: `payments:${orderRef}`,
      recipientRef: orderRef,
      channels: ["email"],
      templateId: "payment-status-changed",
      bodyPattern: "Payment for order {{orderRef}} status changed to {{status}}.",
      subjectPattern: "Payment update for order {{orderRef}}",
      variables: { orderRef, status },
      maxAttempts: PaymentsNotificationAdapter.DEFAULT_MAX_ATTEMPTS,
    });
    if (createResponse.status >= 400) {
      throw new Error(
        `PaymentsNotificationAdapter: create failed for order "${orderRef}" ` +
          `(status ${createResponse.status}): ${JSON.stringify(createResponse.body)}`,
      );
    }
    const { notificationId } = createResponse.body as CreateNotificationBody;

    const queueResponse = await this.notifications.queue({ notificationId });
    if (queueResponse.status >= 400) {
      throw new Error(
        `PaymentsNotificationAdapter: queue failed for order "${orderRef}" ` +
          `(status ${queueResponse.status}): ${JSON.stringify(queueResponse.body)}`,
      );
    }

    const sendResponse = await this.notifications.send({ notificationId });
    if (sendResponse.status >= 400) {
      throw new Error(
        `PaymentsNotificationAdapter: send failed for order "${orderRef}" ` +
          `(status ${sendResponse.status}): ${JSON.stringify(sendResponse.body)}`,
      );
    }
  }
}
