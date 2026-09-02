/**
 * Delivery Queue (directive §Queue Responsibilities).
 *
 * The queue owns **scheduling, priority, delay, replay scheduling and dead-letter recovery — and
 * nothing else.** It performs no routing, no mapping, no enrichment and no hashing; it does not
 * inspect an event's payload or identity. It moves work in time.
 *
 * That boundary is enforced by the shape of the types here: a queue item carries an **event id and
 * a destination key**, never an envelope, an identity block or a payload. There is nothing in a
 * queue item to map or hash even if some future caller wanted to.
 */

import type { DestinationKey } from "../delivery/destination";

/**
 * Scheduling priority. Revenue events outrank engagement events when a backlog forms — a delayed
 * purchase conversion costs attribution accuracy and ad-platform optimisation, a delayed page view
 * costs almost nothing.
 */
export type QueuePriority = "critical" | "high" | "normal" | "low";

export const QUEUE_PRIORITIES: readonly QueuePriority[] = ["critical", "high", "normal", "low"];

const PRIORITY_ORDER: Readonly<Record<QueuePriority, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Why an item is queued — kept for operational visibility, not for routing decisions. */
export type QueueReason = "initial" | "retry" | "rate_limited" | "replay" | "dead_letter_recovery";

/**
 * A unit of scheduled work. Deliberately opaque: ids only, so the queue cannot become a second
 * place where payloads are shaped.
 */
export interface QueueItem {
  readonly itemId: string;
  readonly tenantId: string;
  readonly eventId: string;
  readonly destination: DestinationKey;
  readonly priority: QueuePriority;
  readonly reason: QueueReason;
  /** Epoch ms before which the item must not be dispatched. */
  readonly availableAtMs: number;
  readonly enqueuedAtMs: number;
  readonly attempt: number;
  /** Set for replay-scheduled work, so a replay's items are cancellable as a group. */
  readonly replayId?: string;
}

/**
 * Orders the queue: earliest-available first, then by priority, then FIFO by enqueue time.
 *
 * Availability dominates priority deliberately — a `critical` item scheduled for 30 seconds from
 * now must not preempt a `low` item that is ready now, or a rate-limit backoff would be defeated
 * by priority and we would hammer a vendor we just agreed to back off from.
 */
export function compareQueueItems(a: QueueItem, b: QueueItem): number {
  return (
    a.availableAtMs - b.availableAtMs ||
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    a.enqueuedAtMs - b.enqueuedAtMs
  );
}

/** Items ready to dispatch at `nowMs`, in dispatch order. Pure — no mutation, no side effects. */
export function dueItems(
  items: readonly QueueItem[],
  nowMs: number,
  limit?: number,
): readonly QueueItem[] {
  const due = items.filter((item) => item.availableAtMs <= nowMs).sort(compareQueueItems);
  return limit === undefined ? due : due.slice(0, limit);
}

/** Schedules an item after a delay. Used for retry backoff and rate-limit deferral. */
export function scheduleAfter(item: QueueItem, delayMs: number, nowMs: number): QueueItem {
  return { ...item, availableAtMs: nowMs + Math.max(0, delayMs), attempt: item.attempt + 1 };
}

/** Default priority per event category, overridable per tenant at the composition root. */
export function defaultPriority(eventName: string): QueuePriority {
  if (eventName === "purchase" || eventName === "refund") return "critical";
  if (eventName === "checkout_started" || eventName === "add_to_cart") return "high";
  if (eventName === "page_viewed") return "low";
  return "normal";
}

/**
 * Queue port. The concrete implementation (Redis/Kafka/Temporal) is wired at the composition root;
 * this contract is all the delivery layer knows about scheduling.
 */
export interface DeliveryQueuePort {
  enqueue(item: QueueItem): Promise<void>;
  /** Claims up to `limit` due items. Implementations must make the claim atomic. */
  claim(limit: number, nowMs: number): Promise<readonly QueueItem[]>;
  complete(itemId: string): Promise<void>;
  /** Reschedules a claimed item — retry backoff, rate-limit deferral. */
  defer(itemId: string, availableAtMs: number): Promise<void>;
  /** Cancels every item belonging to a replay, so a cancelled replay stops promptly. */
  cancelReplay(replayId: string): Promise<number>;
  depth(destination?: DestinationKey): Promise<number>;
}

/**
 * Dead-letter recovery. Recovering a dead letter is a **replay**, not a fresh delivery: it re-sends
 * the stored payload and is subject to the same audit trail.
 */
export interface DeadLetterRecoveryPort {
  /** Dead-lettered event/destination pairs matching a filter, for operator-driven recovery. */
  list(filter: {
    readonly tenantId: string;
    readonly destination?: DestinationKey;
    readonly from?: string;
    readonly to?: string;
    readonly limit?: number;
  }): Promise<readonly { readonly eventId: string; readonly destination: DestinationKey }[]>;
}
