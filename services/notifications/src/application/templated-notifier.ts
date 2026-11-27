import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { NotificationSettingsRepository } from "../domain/messaging/messaging-repositories";
import { effectiveNotificationSettings } from "../domain/messaging/notification-settings";
import { isTemplateEnabled, type TemplateKey } from "../domain/messaging/template-catalogue";
import type {
  AdvanceNotification,
  QueueNotification,
  SendNotification,
} from "./notification-lifecycle.use-cases";
import type { CreateNotification } from "./create-notification.use-case";
import { staffRecipientRef } from "./staff-recipient-ref";

export interface TemplatedNotificationRequest {
  readonly tenantId: string;
  readonly template: TemplateKey;
  /**
   * What makes this mail ONE event (an order id, `<order>:<refund id>`, ...). The notification's
   * idempotency key is `<template>:<eventKey>`: a retried transition never mails twice (D41).
   */
  readonly eventKey: string;
  /** A bare reference to what triggered it, e.g. `orders:#1042`. */
  readonly sourceRef: string;
  /** A customer reference, `staff:<hash>`, or any bare reference the provider can resolve. */
  readonly recipientRef: string;
  /** Stored on the notification row: no address, no secret, no body (ADR-0006). */
  readonly variables: Readonly<Record<string, string>>;
  /** Used for this one send and never stored (a bearer link, a one-off recipient). */
  readonly transient?: Readonly<Record<string, string>>;
}

export interface TemplatedNotificationOutcome {
  readonly notificationId: string;
  readonly status: string;
  /** true when this event already had a notification: nothing was sent now. */
  readonly deduplicated: boolean;
}

export interface TemplatedNotifierDeps {
  readonly settings: NotificationSettingsRepository;
  readonly create: Pick<CreateNotification, "execute">;
  readonly queue: Pick<QueueNotification, "execute">;
  readonly send: Pick<SendNotification, "execute">;
  readonly advance: Pick<AdvanceNotification, "execute">;
}

const MAX_ATTEMPTS = 3;

/**
 * Wave 2b: the one entry the order, payment, fulfilment and draft-order triggers use. It records ONE
 * notification per event, then (unless the template is switched off) queues and sends it through the
 * normal lifecycle. A switched-off template leaves a `cancelled` row with reason `DISABLED` so the
 * delivery log shows why nothing went out. Replaces the old generic "status changed" mail (D41).
 *
 * It RETURNS a `Result` for domain failures and throws only for infrastructure failures; every
 * trigger wraps it so a failure here can never fail the order/payment/fulfilment transition (D42).
 */
export class TemplatedNotifier {
  private readonly deps: TemplatedNotifierDeps;

  constructor(deps: TemplatedNotifierDeps) {
    this.deps = deps;
  }

  async execute(
    request: TemplatedNotificationRequest,
  ): Promise<Result<TemplatedNotificationOutcome, DomainError>> {
    const stored = await this.deps.settings.find(request.tenantId);
    const enabled = isTemplateEnabled(
      request.template,
      effectiveNotificationSettings(stored).disabledTemplates,
    );

    const created = await this.deps.create.execute({
      tenantId: request.tenantId,
      idempotencyKey: `${request.template}:${request.eventKey}`,
      sourceRef: request.sourceRef,
      recipientRef: request.recipientRef,
      channels: ["email"],
      templateId: request.template,
      // The merchant's copy is rendered at send time from the live template; the row keeps a marker only.
      bodyPattern: `[[${request.template}]]`,
      subjectPattern: `[[${request.template}]]`,
      variables: request.variables,
      maxAttempts: MAX_ATTEMPTS,
    });
    if (!created.ok) return err(created.error);
    const { notificationId, status } = created.value;
    const ids = { tenantId: request.tenantId, notificationId };

    // Only a notification that has not been sent yet is worked on: a replay of the same event
    // finds it `sent`, `failed`, `cancelled`... and does nothing (retrying is the delivery log's job).
    if (status !== "created" && status !== "queued") {
      return ok({ notificationId, status, deduplicated: true });
    }

    if (!enabled) {
      const cancelled = await this.deps.advance.execute({
        ...ids,
        toStatus: "cancelled",
        reason: "DISABLED",
      });
      if (!cancelled.ok) return err(cancelled.error);
      return ok({ notificationId, status: cancelled.value.status, deduplicated: false });
    }

    if (status === "created") {
      const queued = await this.deps.queue.execute(ids);
      if (!queued.ok) return err(queued.error);
    }
    const sent = await this.deps.send.execute({
      ...ids,
      ...(request.transient === undefined ? {} : { transientVariables: request.transient }),
    });
    if (!sent.ok) return err(sent.error);
    return ok({ notificationId, status: sent.value.status, deduplicated: false });
  }

  /**
   * One notification per configured staff recipient (`staff_new_order`). With nobody configured
   * nothing is recorded: there is no one to tell.
   */
  async executeForStaff(
    request: Omit<TemplatedNotificationRequest, "recipientRef">,
  ): Promise<readonly Result<TemplatedNotificationOutcome, DomainError>[]> {
    const stored = await this.deps.settings.find(request.tenantId);
    const recipients = effectiveNotificationSettings(stored).staffRecipients;
    const results: Result<TemplatedNotificationOutcome, DomainError>[] = [];
    let failure: unknown;
    for (const email of recipients) {
      const recipientRef = staffRecipientRef(email);
      try {
        results.push(
          await this.execute({
            ...request,
            eventKey: `${request.eventKey}:${recipientRef.slice(-16)}`,
            recipientRef,
          }),
        );
      } catch (error) {
        // One recipient's failure never stops the others; the first is rethrown for the caller to log.
        failure ??= error;
      }
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- re-throws whatever the first recipient's send threw, unchanged
    if (failure !== undefined) throw failure;
    return results;
  }
}
