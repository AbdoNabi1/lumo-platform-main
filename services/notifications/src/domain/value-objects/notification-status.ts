import { ValueObject } from "@platform/domain";

export type NotificationStatusValue =
  | "created"
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "retrying"
  | "dead_letter"
  | "cancelled"
  | "expired";

/**
 * The validated lifecycle transition table (Sprint 4.12).
 *
 * Phase A.16 (Task 7/8): `queued -> failed` and `retrying -> failed` were missing from this table —
 * an illegal-transition-incorrectly-rejected defect, not a deliberate business rule. `queued` and
 * `retrying` are exactly the two statuses `SendNotification.execute()` (`notification-lifecycle.
 * use-cases.ts`) dispatches a provider send from; a dispatch failure calls `Notification.markFailed`,
 * which transitions to `"failed"`. Before this fix, that transition always threw `BusinessRuleError`
 * ("Cannot transition notification from queued to failed") — the ONLY way to legally reach `"failed"`
 * was `sent -> failed` (a post-send delivery bounce, a DIFFERENT failure mode). Confirmed via the
 * domain's own `RetryNotification`/`Notification.retry()`: `retry()`'s `transition("retrying"|
 * "dead_letter"|"expired", ...)` calls only succeed from `"failed"` — i.e. the ENTIRE
 * retry/dead-letter/expiry pipeline was unreachable from a real send-dispatch failure, only from a
 * bounce. This was confirmed empirically against the pre-fix table (Phase A.15's
 * `send-notification-transaction-boundary.test.ts`, now updated) before making this change — see
 * PHASE_A16 report §Notifications Findings.
 */
const TRANSITIONS: Readonly<Record<NotificationStatusValue, readonly NotificationStatusValue[]>> = {
  created: ["queued", "cancelled"],
  queued: ["sent", "failed", "cancelled"],
  sent: ["delivered", "failed"],
  delivered: [],
  failed: ["retrying", "dead_letter", "expired"],
  retrying: ["sent", "failed", "dead_letter", "expired"],
  dead_letter: [],
  cancelled: [],
  expired: [],
};

/** Whether a transition from `from` to `to` is allowed by the notification lifecycle's transition table. */
export function canTransitionNotification(
  from: NotificationStatusValue,
  to: NotificationStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

interface NotificationStatusProps {
  readonly value: NotificationStatusValue;
}

/** The lifecycle state of a notification (a closed set of internal states; not external input). */
export class NotificationStatus extends ValueObject<NotificationStatusProps> {
  static created(): NotificationStatus {
    return new NotificationStatus({ value: "created" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: NotificationStatusValue): NotificationStatus {
    return new NotificationStatus({ value });
  }

  get value(): NotificationStatusValue {
    return this.props.value;
  }
}
