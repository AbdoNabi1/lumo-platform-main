/**
 * T5.11a — UI-only copy of the backend's authoritative notification status transition table
 * (`services/notifications/src/domain/value-objects/notification-status.ts`'s `TRANSITIONS`).
 * `apps/*` may never import `services/*` (`docs/plans/README.md`'s global constraints), so this is
 * a hand-kept copy, not an import — if the backend's table ever changes, this one must be updated
 * to match by hand. Same technique as `lib/review-lifecycle.ts`/`lib/fulfillment-lifecycle.ts`.
 */
export const NOTIFICATION_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
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

/**
 * `queue`/`send`/`retry` are dedicated actions implying specific targets, gated by their own
 * source status(es) (same `canXFrom`/`DEDICATED_COVERED_TARGETS` pattern `lib/fulfillment-
 * lifecycle.ts` established for T5.4):
 * - `queue` (`POST /notifications/:id/queue`) — `created` -> `queued` (offered only at `created`)
 * - `send`  (`POST /notifications/:id/send`)  — `queued`/`retrying` -> `sent` (offered at both,
 *   same "one dedicated action, several source statuses" shape `send`/`ship` use in Fulfillment)
 * - `retry` (`POST /notifications/:id/retry`) — `failed` -> `retrying` (offered only at `failed`)
 * The generic advance dropdown (`POST /notifications/:id/transitions`) covers everything each
 * status's transition-table entry lists beyond what its dedicated action(s) already cover — e.g.
 * `queued` -> `cancelled`, `failed` -> `dead_letter`/`expired` directly without retrying, and both
 * of `sent`'s targets (`delivered`/`failed`), since no dedicated action moves *out of* `sent`.
 */
const QUEUE_STATUSES: ReadonlySet<string> = new Set(["created"]);
const SEND_STATUSES: ReadonlySet<string> = new Set(["queued", "retrying"]);
const RETRY_STATUSES: ReadonlySet<string> = new Set(["failed"]);

/** Whether `NotificationLifecycleActions` should offer the "Queue" action at `status`. */
export function canQueueFrom(status: string): boolean {
  return QUEUE_STATUSES.has(status);
}

/** Whether `NotificationLifecycleActions` should offer the "Send" action at `status`. */
export function canSendFrom(status: string): boolean {
  return SEND_STATUSES.has(status);
}

/** Whether `NotificationLifecycleActions` should offer the "Retry" action at `status`. */
export function canRetryFrom(status: string): boolean {
  return RETRY_STATUSES.has(status);
}

/**
 * The transition targets the 3 dedicated actions above are understood to cover at each source
 * status — used only to compute the generic advance dropdown's residual options below, never to
 * decide whether a dedicated action itself renders (that's `canQueueFrom`/`canSendFrom`/
 * `canRetryFrom`).
 */
const DEDICATED_COVERED_TARGETS: Readonly<Record<string, readonly string[]>> = {
  created: ["queued"],
  queued: ["sent"],
  failed: ["retrying"],
  retrying: ["sent"],
};

/**
 * The statuses the generic "advance to…" dropdown may offer from `status` — the full transition
 * table entry, minus whatever targets a dedicated action at this status already covers. Returns an
 * empty array for a terminal status (`delivered`/`dead_letter`/`cancelled`/`expired`), an
 * unrecognized one, or a status fully covered by its dedicated action — the caller renders no
 * dropdown at all in that case, not a disabled one with nothing in it.
 */
export function advanceableNotificationStatusesFrom(status: string): readonly string[] {
  const all = NOTIFICATION_LIFECYCLE_TRANSITIONS[status] ?? [];
  const covered = DEDICATED_COVERED_TARGETS[status] ?? [];
  return all.filter((target) => !covered.includes(target));
}
