import type { NotificationsController } from "@platform/notifications";
import type { NotificationPort } from "@platform/orders";

interface CreateNotificationBody {
  readonly notificationId: string;
}

/**
 * Real `NotificationPort` over Notifications' own create -> queue -> send lifecycle (Phase 3 Task
 * 12, C-3) — `Orders`' lifecycle use cases call this instead of the offline
 * `InMemoryNotificationAdapter` stub (`services/orders/src/infrastructure/in-memory-port-adapters.ts`),
 * which was a pure no-op. The exact 3-step sequence is Notifications' own real caller contract, not
 * invented here — read from `services/notifications/src/notifications.e2e.test.ts`.
 *
 * `NotificationPort` is explicitly documented as best-effort — "reference-only, never blocks a
 * transition's own result" (`services/orders/src/application/ports.ts`) — and its one caller,
 * `notifyBestEffort` (`order-lifecycle.use-cases.ts`), already wraps every call in a swallowing
 * try/catch. So this adapter does no internal error handling of its own: a failure from any of the
 * 3 steps propagates straight out and is swallowed by the caller, exactly as designed.
 *
 * This is deliberately minimal, generic glue content, not a templating/channel-selection system —
 * that would be over-engineering a port whose own contract says it may be dropped entirely without
 * consequence to the order:
 *  - `channels`: a single default, `["email"]` — no multi-channel selection logic.
 *  - `templateId`/`bodyPattern`/`subjectPattern`: a generic "order status changed" message; the
 *    order number/status are interpolated via `variables`, not baked into the pattern strings.
 *  - `maxAttempts`: 3 — Notifications' own domain model (`DeliveryPolicy`) takes any caller-supplied
 *    number and documents no house default anywhere, so this is a deliberately small, defensible
 *    constant, not a discovered convention.
 *  - `idempotencyKey`: `${orderNumber}:${status}`, not a freshly generated id per call —
 *    `notify()` may be invoked more than once for the SAME logical transition (e.g. Orders'
 *    `withConcurrencyRetry` re-running `notifyBestEffort` on a settle retry), and `CreateNotification`
 *    is itself idempotent by `idempotencyKey` (a replay returns the already-created notification
 *    rather than a duplicate) — a fresh id per call would defeat that and mint a new notification on
 *    every retry.
 *  - `sourceRef`: `orders:${orderNumber}` — identifies this as order-lifecycle-sourced.
 */
export class OrdersNotificationAdapter implements NotificationPort {
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;

  private readonly notifications: Pick<NotificationsController, "create" | "queue" | "send">;

  private readonly tenantId: string | undefined;

  /**
   * ADR-0014 (WP-10, T10.3): Notifications now takes `tenantId` per call, but the port this
   * adapter implements carries none yet — widening it is that context's own conversion. Until
   * then the tenant is captured at construction (same not-yet-converted pattern as
   * `PromotionValidationAdapter`). It stays optional only because `AdminWiringDeps.tenantId` is;
   * `notify` throws if it is missing (the caller already swallows notification failures), never
   * defaulting a tenant.
   */
  constructor(
    notifications: Pick<NotificationsController, "create" | "queue" | "send">,
    tenantId?: string,
  ) {
    this.notifications = notifications;
    this.tenantId = tenantId;
  }

  async notify(customerRef: string, orderNumber: string, status: string): Promise<void> {
    const tenantId = this.tenantId;
    if (tenantId === undefined) {
      throw new Error(
        "OrdersNotificationAdapter.notify: tenantId is required (ADR-0014) but this adapter was constructed without one.",
      );
    }
    const idempotencyKey = `${orderNumber}:${status}`;

    const createResponse = await this.notifications.create({
      tenantId,
      idempotencyKey,
      sourceRef: `orders:${orderNumber}`,
      recipientRef: customerRef,
      channels: ["email"],
      templateId: "order-status-changed",
      bodyPattern: "Order {{orderNumber}} status changed to {{status}}.",
      subjectPattern: "Order {{orderNumber}} update",
      variables: { orderNumber, status },
      maxAttempts: OrdersNotificationAdapter.DEFAULT_MAX_ATTEMPTS,
    });
    if (createResponse.status >= 400) {
      throw new Error(
        `OrdersNotificationAdapter: create failed for order "${orderNumber}" ` +
          `(status ${createResponse.status}): ${JSON.stringify(createResponse.body)}`,
      );
    }
    const { notificationId } = createResponse.body as CreateNotificationBody;

    const queueResponse = await this.notifications.queue({ notificationId, tenantId });
    if (queueResponse.status >= 400) {
      throw new Error(
        `OrdersNotificationAdapter: queue failed for order "${orderNumber}" ` +
          `(status ${queueResponse.status}): ${JSON.stringify(queueResponse.body)}`,
      );
    }

    const sendResponse = await this.notifications.send({ notificationId, tenantId });
    if (sendResponse.status >= 400) {
      throw new Error(
        `OrdersNotificationAdapter: send failed for order "${orderNumber}" ` +
          `(status ${sendResponse.status}): ${JSON.stringify(sendResponse.body)}`,
      );
    }
  }
}
