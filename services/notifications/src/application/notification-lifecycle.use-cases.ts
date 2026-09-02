import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError, NotFoundError } from "@platform/utils";
import type { NotificationRepository } from "../domain/notification-repository";
import type { NotificationStatusValue } from "../domain/value-objects/notification-status";
import type { NotificationStatusOutput } from "./create-notification.use-case";
import type {
  EmailProviderPort,
  ProviderSendRequest,
  ProviderSendResult,
  PushProviderPort,
  SmsProviderPort,
  WebhookProviderPort,
} from "./ports";

export interface NotificationIdInput {
  readonly notificationId: string;
}

export interface AdvanceNotificationInput extends NotificationIdInput {
  readonly toStatus: NotificationStatusValue;
}

export interface NotificationLifecycleDeps {
  readonly notifications: NotificationRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Queues a created notification for delivery. */
export class QueueNotification implements UseCase<
  NotificationIdInput,
  NotificationStatusOutput,
  DomainError
> {
  private readonly deps: NotificationLifecycleDeps;

  constructor(deps: NotificationLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: NotificationIdInput,
  ): Promise<Result<NotificationStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<NotificationStatusOutput, DomainError>>(async (tx) => {
      const notification = await this.deps.notifications.findById(input.notificationId, tx);
      if (notification === null) {
        return err(new NotFoundError("Notification not found"));
      }

      try {
        notification.queue(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.notifications.save(notification, tx);
      return ok({ notificationId: notification.id.toString(), status: notification.status.value });
    });
  }
}

/** Generic validated transition — used for `cancel`/`expire` (any transition the current status's transition table allows). */
export class AdvanceNotification implements UseCase<
  AdvanceNotificationInput,
  NotificationStatusOutput,
  DomainError
> {
  private readonly deps: NotificationLifecycleDeps;

  constructor(deps: NotificationLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: AdvanceNotificationInput,
  ): Promise<Result<NotificationStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<NotificationStatusOutput, DomainError>>(async (tx) => {
      const notification = await this.deps.notifications.findById(input.notificationId, tx);
      if (notification === null) {
        return err(new NotFoundError("Notification not found"));
      }

      try {
        notification.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.notifications.save(notification, tx);
      return ok({ notificationId: notification.id.toString(), status: notification.status.value });
    });
  }
}

export interface SendNotificationDeps extends NotificationLifecycleDeps {
  readonly emailProvider: EmailProviderPort;
  readonly smsProvider: SmsProviderPort;
  readonly pushProvider: PushProviderPort;
  readonly webhookProvider: WebhookProviderPort;
}

interface SendPrecheck {
  readonly channel: string;
  readonly request: ProviderSendRequest;
}

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.15, reusing the shape Payments'
 * `withConcurrencyRetry` established in Phase A.4/A.8, also duplicated in Licensing's
 * `billing.use-cases.ts` for `CollectInvoice`) — `PrismaNotificationRepository.save` throws
 * `ConcurrencyError` when a concurrent writer already advanced the row's `version`; that is
 * expected/recoverable (two racing `SendNotification` calls settling the same notification), so
 * the read-check-write attempt is retried from scratch against the now-current row. Any other
 * error propagates immediately.
 */
async function withConcurrencyRetry<T>(maxAttempts: number, attempt: () => Promise<T>): Promise<T> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ConcurrencyError) || i === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("unreachable");
}

/**
 * Routes delivery to the notification's current channel's provider port (`in_app` is delivered
 * internally, no provider call). The domain touches no provider directly.
 *
 * Phase A.15 (Task 3/3, cross-context transaction-boundary remediation, A.14 §11 finding — flagged
 * there as "the most load-sensitive instance, since every notification send holds a DB transaction
 * open for a real external round trip"): the provider `.send()` call used to run INSIDE the same
 * `unitOfWork.run` transaction that read and would persist the notification, holding a DB
 * connection open for the full duration of a real network round-trip to email/SMS/push/webhook
 * infrastructure. `Notification`'s status machine has no `sending`-style intermediate status to
 * durably reserve before the provider call (confirmed via `notification-status.ts`'s `TRANSITIONS`
 * table), so — per this phase's brief — this reuses the same simple precheck → external-call →
 * settle shape Returns' `DecideResolution` (A.13.1) and Licensing's `CollectInvoice` (A.15) use for
 * that exact shape, NOT the full reserve/settle pattern Payments' `CapturePaymentLifecycle` needs
 * (that one exists because Payments DOES have a durable `processing`-style precursor status):
 *   1. `precheck` — a short, read-only transaction: 404s if missing, and computes `channel`,
 *      `request` (rendered subject/body + `idempotencyKey`) from ONE consistent read. These are
 *      returned as plain values threaded through the following steps as parameters — never stashed
 *      on `this` (an instance field would corrupt concurrent callers, since one `SendNotification`
 *      instance is shared/reused across concurrent `execute()` calls).
 *   2. The provider `.send()` call, deliberately OUTSIDE any open transaction. `in_app` short-
 *      circuits here with no provider call at all (delivered internally) — routed through the same
 *      shape for consistency, not because it has a transaction-boundary problem to fix.
 *   3. `settle` — re-reads the notification in its OWN transaction and applies `markSent` (success)
 *      or `markFailed` (provider threw), then saves. Each outcome has its own settle call, mirroring
 *      `RefundPaymentLifecycle.execute`'s `this.settle(..., { succeeded: true | false })` split.
 *      `settleSuccess` treats an already-`sent` notification as a no-op resume (mirrors Capture's
 *      A.9 `alreadyCaptured` guard) — the loser of a concurrent race gets a clean idempotent `ok`
 *      instead of surfacing the domain's own "cannot transition sent -> sent" rejection.
 *
 * On provider-send failure, `execute()` returns `ok({ ..., status: "failed" })` — as of Phase A.16
 * this is now the ACTUAL outcome, not just the shape's intent. See FSM DEFECT FIXED below.
 *
 * FSM DEFECT FIXED (Phase A.16, Task 7/8 — was documented as a residual defect through A.15):
 * `notification-status.ts`'s `TRANSITIONS` table used to only allow `"failed"` to be reached FROM
 * `"sent"` (`sent: ["delivered", "failed"]`); `"queued"` and `"retrying"` — the two statuses
 * `SendNotification` actually runs from — did NOT list `"failed"` as a legal target, so the
 * `markFailed()` call in the provider-failure branch always threw `BusinessRuleError` ("Cannot
 * transition notification from queued to failed"), converted by the surrounding try/catch to
 * `err(BusinessRuleError)` — never the `ok({ status: "failed" })` the code's own shape assumed. This
 * was a genuine illegal-transition-incorrectly-rejected bug, not a deliberate business rule — the
 * domain's OWN `retry()` method requires `"failed"` to be reachable to ever run at all (see
 * `notification-status.ts`'s doc for the full trace). Fixed by adding `"failed"` to `queued`'s and
 * `retrying`'s transition lists (the smallest possible correction — no new states, no new methods).
 * `settleFailure` also gained an idempotent-resume guard (mirroring `settleSuccess`'s `!== "sent"`
 * check) — required now that `"failed"` is reachable, else two concurrent provider failures would
 * have the second racer's `markFailed()` hit `failed`'s empty self-transition list and throw. See
 * `notification-fsm-regression.test.ts`.
 *
 * RESIDUAL RISK (documented, not fixed): `idempotencyKey` is `<id>:attempt:<attempts.length>`,
 * read once at `precheck` time. It is stable across a crash-before-settle retry (nothing committed,
 * so a re-`execute()` re-derives the identical key) and identical for two genuinely concurrent
 * callers (both precheck-read the same `attempts.length`, so both present the SAME key to the
 * provider — the provider's own idempotency contract, not this code, is what collapses that into
 * one real send). It is NOT stable across a blind retry of `execute()` on an ALREADY-`sent`
 * notification: `attempts.length` has advanced by then, so a second `execute()` call computes a
 * DIFFERENT key and genuinely re-sends. This is unchanged from the pre-fix code (which derived the
 * key the exact same way, fresh, every call) — not a regression this refactor introduces.
 */
export class SendNotification implements UseCase<
  NotificationIdInput,
  NotificationStatusOutput,
  DomainError
> {
  private readonly deps: SendNotificationDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: SendNotificationDeps) {
    this.deps = deps;
  }

  async execute(
    input: NotificationIdInput,
  ): Promise<Result<NotificationStatusOutput, DomainError>> {
    const precheck = await this.precheck(input.notificationId);
    if (!precheck.ok) return err(precheck.error);
    const { channel, request } = precheck.value;

    let providerRef: string;
    try {
      const result = await this.sendViaChannel(channel, request);
      providerRef = result.providerRef;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "provider send failed";
      return this.settleFailure(input.notificationId, reason);
    }

    return this.settleSuccess(input.notificationId, providerRef);
  }

  private async precheck(notificationId: string): Promise<Result<SendPrecheck, DomainError>> {
    return this.deps.unitOfWork.run<Result<SendPrecheck, DomainError>>(async (tx) => {
      const notification = await this.deps.notifications.findById(notificationId, tx);
      if (notification === null) {
        return err(new NotFoundError("Notification not found"));
      }

      const rendered = notification.render();
      const channel = notification.currentChannel.value;
      const idempotencyKey = `${notification.id.toString()}:attempt:${notification.attempts.length}`;
      const request: ProviderSendRequest = {
        recipientRef: notification.recipient.customerRef,
        subject: rendered.subject,
        body: rendered.body,
        idempotencyKey,
      };

      return ok({ channel, request });
    });
  }

  private async sendViaChannel(
    channel: string,
    request: ProviderSendRequest,
  ): Promise<ProviderSendResult> {
    switch (channel) {
      case "email":
        return this.deps.emailProvider.send(request);
      case "sms":
        return this.deps.smsProvider.send(request);
      case "push":
        return this.deps.pushProvider.send(request);
      case "webhook":
        return this.deps.webhookProvider.send(request);
      case "in_app":
        return { providerRef: "in_app" };
      default:
        throw new Error(`Unknown notification channel: ${channel}`);
    }
  }

  private async settleSuccess(
    notificationId: string,
    providerRef: string,
  ): Promise<Result<NotificationStatusOutput, DomainError>> {
    return withConcurrencyRetry(SendNotification.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<NotificationStatusOutput, DomainError>>(async (tx) => {
        const notification = await this.deps.notifications.findById(notificationId, tx);
        if (notification === null) {
          return err(new NotFoundError("Notification not found"));
        }

        // A losing concurrent race (or a resumed retry after the winner already committed) finds
        // the notification already `sent` — a pure no-op, not a re-transition attempt, mirroring
        // Capture's Phase A.9 `alreadyCaptured` guard.
        if (notification.status.value !== "sent") {
          try {
            notification.markSent(
              providerRef,
              this.deps.idGenerator.generate(),
              this.deps.clock.now(),
            );
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.notifications.save(notification, tx);
        }

        return ok({
          notificationId: notification.id.toString(),
          status: notification.status.value,
        });
      }),
    );
  }

  private async settleFailure(
    notificationId: string,
    reason: string,
  ): Promise<Result<NotificationStatusOutput, DomainError>> {
    return withConcurrencyRetry(SendNotification.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<NotificationStatusOutput, DomainError>>(async (tx) => {
        const notification = await this.deps.notifications.findById(notificationId, tx);
        if (notification === null) {
          return err(new NotFoundError("Notification not found"));
        }

        // Phase A.16 (Task 8): idempotent-resume guard, mirroring `settleSuccess`'s `!== "sent"`
        // check — required now that `queued -> failed`/`retrying -> failed` are legal (Task 7). Two
        // concurrent racers whose provider calls BOTH fail would otherwise have the second one
        // re-call `markFailed()` on an ALREADY-`failed` notification: `failed` has no self-transition
        // (`TRANSITIONS.failed` doesn't list `"failed"`), so it would throw `BusinessRuleError` and
        // surface as `err(...)` instead of a safe no-op resume — the same class of defect Phase A.9
        // fixed for `RecordWebhook` and A.11 fixed for `AuthorizePayment`.
        if (notification.status.value !== "failed") {
          try {
            notification.markFailed(
              reason,
              this.deps.idGenerator.generate(),
              this.deps.clock.now(),
            );
          } catch (domainError) {
            if (isDomainError(domainError)) return err(domainError);
            throw domainError;
          }
          await this.deps.notifications.save(notification, tx);
        }

        return ok({
          notificationId: notification.id.toString(),
          status: notification.status.value,
        });
      }),
    );
  }
}

/** Retries a failed notification per its delivery policy (fallback channel / dead-letter / expire). */
export class RetryNotification implements UseCase<
  NotificationIdInput,
  NotificationStatusOutput,
  DomainError
> {
  private readonly deps: NotificationLifecycleDeps;

  constructor(deps: NotificationLifecycleDeps) {
    this.deps = deps;
  }

  async execute(
    input: NotificationIdInput,
  ): Promise<Result<NotificationStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<NotificationStatusOutput, DomainError>>(async (tx) => {
      const notification = await this.deps.notifications.findById(input.notificationId, tx);
      if (notification === null) {
        return err(new NotFoundError("Notification not found"));
      }

      try {
        notification.retry(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.notifications.save(notification, tx);
      return ok({ notificationId: notification.id.toString(), status: notification.status.value });
    });
  }
}
