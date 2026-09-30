import type { Clock } from "@platform/contracts";
import type { Logger } from "@platform/utils";
import type { IncomingMessage } from "../consumer/incoming-message";
import type { OutboxEntry } from "./outbox-entry";

/**
 * A consumer the relay can hand a message to directly, with no broker in between. `deliver` effects
 * the message once (idempotently — it owns its own inbox check) or THROWS; it never schedules its
 * own retry, because under this transport the outbox row is the retry state.
 */
export interface DirectConsumer {
  /** The topic this consumer subscribes to (`<type>.v<version>`). */
  readonly topic: string;
  readonly consumerGroup: string;
  deliver(message: IncomingMessage): Promise<void>;
  /** Records a delivery that exhausted its retries. Called once per consumer still failing. */
  deadLetter(input: DirectDeadLetter): Promise<void>;
}

export interface DirectDeadLetter {
  /** The outbox row id, which IS the integration event's `messageId` (`OutboxEntry.id`). */
  readonly messageId: string;
  readonly message: IncomingMessage;
  /** Delivery rounds the row went through; this consumer failed the last one. */
  readonly attempts: number;
  readonly error: unknown;
}

/** A pending outbox row that is due, with the number of delivery rounds that already failed. */
export interface DueOutboxEntry {
  readonly entry: OutboxEntry;
  readonly attempts: number;
}

/**
 * The outbox table read as a delivery queue. Separate from `OutboxStore` on purpose: that port is
 * the producer's write side plus the Kafka relay's batch publish, and neither knows about a row
 * that is pending but not yet due.
 *
 * Contract notes for implementations:
 * - `fetchDue` returns pending rows whose next attempt is due at `now`, in insertion order. A row
 *   waiting on a retry MUST NOT be returned and MUST NOT count against `limit` — otherwise enough
 *   waiting rows would fill every batch and nothing behind them would ever be delivered.
 * - `markDelivered` and `defer` act only on rows still pending, so a second relay racing the first
 *   degrades to a duplicate delivery (which consumers tolerate) and never resurrects a row.
 */
export interface OutboxDeliveryQueue {
  fetchDue(limit: number, now: string): Promise<readonly DueOutboxEntry[]>;
  markDelivered(ids: readonly string[], deliveredAt: string): Promise<void>;
  defer(id: string, attempts: number, availableAt: string): Promise<void>;
}

export interface OutboxDeliveryRelayDeps {
  readonly queue: OutboxDeliveryQueue;
  readonly consumers: readonly DirectConsumer[];
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * Delay before each retry round; its length is the number of retries before dead-lettering. The
   * runtime passes the same schedule the Kafka transport uses, so switching transport does not
   * change how long a failing message is retried.
   */
  readonly retryDelaysMs: readonly number[];
  /** Max rows taken per pass (default 100). */
  readonly batchSize?: number;
}

export interface OutboxDeliveryReport {
  /** Rows every subscribed consumer effected (or had already effected). */
  readonly delivered: number;
  /** Rows on a topic nobody subscribes to — marked delivered, since there is no one to deliver to. */
  readonly unrouted: number;
  /** Rows at least one consumer failed, left pending for a later round. */
  readonly deferred: number;
  /** Rows that exhausted the schedule; each still-failing consumer got a dead-letter record. */
  readonly deadLettered: number;
}

/**
 * Delivers pending outbox rows straight to in-process consumers — the broker-less transport
 * (`EVENT_TRANSPORT=postgres`). The outbox table is the queue: a row stays `pending` until every
 * consumer subscribed to its topic has effected it, or the retry schedule is exhausted.
 *
 * Each row is settled on its own, which is the difference from `OutboxRelay` (publish a batch, then
 * mark the batch): there one bad record stalls everything behind it; here a failing row is deferred
 * and the pass carries on.
 *
 * What it guarantees, and what it does not:
 * - **At-least-once.** A crash between a consumer's effect and `markDelivered` redelivers the row.
 *   Consumers dedupe on `messageId` through their own inbox, exactly as they do under Kafka.
 * - **One row, several consumers.** A row is redelivered to ALL its consumers until none fails; the
 *   ones that already succeeded skip it through their inbox. The attempt count is therefore per
 *   ROW, not per consumer.
 * - **Ordering.** Rows are delivered in insertion order within a pass, but a deferred row is
 *   overtaken by the rows behind it — the same trade Kafka's retry topics make.
 * - **No fan-out to a consumer added later.** A row on a topic with no subscriber is marked
 *   delivered at once; a consumer registered afterwards never sees it (as with a Kafka consumer
 *   that starts at the latest offset).
 * - **Single-flight is the caller's job.** Two relays draining at once deliver twice. The runtime
 *   holds a distributed lock around `drainOnce`.
 */
export class OutboxDeliveryRelay {
  private readonly deps: OutboxDeliveryRelayDeps;
  private readonly consumersByTopic: ReadonlyMap<string, readonly DirectConsumer[]>;

  constructor(deps: OutboxDeliveryRelayDeps) {
    this.deps = deps;
    const byTopic = new Map<string, DirectConsumer[]>();
    for (const consumer of deps.consumers) {
      const list = byTopic.get(consumer.topic) ?? [];
      list.push(consumer);
      byTopic.set(consumer.topic, list);
    }
    this.consumersByTopic = byTopic;
  }

  /** Runs one pass over the rows that are due. */
  async drainOnce(): Promise<OutboxDeliveryReport> {
    const batch = await this.deps.queue.fetchDue(
      this.deps.batchSize ?? 100,
      this.deps.clock.now().toISOString(),
    );

    const unrouted = batch.filter((due) => !this.consumersByTopic.has(due.entry.topic));
    if (unrouted.length > 0) {
      await this.deps.queue.markDelivered(
        unrouted.map((due) => due.entry.id),
        this.deps.clock.now().toISOString(),
      );
    }

    let delivered = 0;
    let deferred = 0;
    let deadLettered = 0;
    for (const due of batch) {
      const consumers = this.consumersByTopic.get(due.entry.topic);
      if (consumers === undefined) continue;
      const outcome = await this.deliverRow(due, consumers);
      if (outcome === "delivered") delivered += 1;
      else if (outcome === "deferred") deferred += 1;
      else deadLettered += 1;
    }
    return { delivered, unrouted: unrouted.length, deferred, deadLettered };
  }

  private async deliverRow(
    due: DueOutboxEntry,
    consumers: readonly DirectConsumer[],
  ): Promise<"delivered" | "deferred" | "dead-lettered"> {
    const { entry } = due;
    const message: IncomingMessage = {
      topic: entry.topic,
      key: entry.key,
      value: entry.payload,
      headers: entry.headers,
    };

    // Every consumer is tried even after one fails: they are independent, and holding back the
    // healthy ones would make one broken consumer delay all the others on its topic.
    const failures: { readonly consumer: DirectConsumer; readonly error: unknown }[] = [];
    for (const consumer of consumers) {
      try {
        await consumer.deliver(message);
      } catch (error) {
        failures.push({ consumer, error });
      }
    }

    if (failures.length === 0) {
      await this.deps.queue.markDelivered([entry.id], this.deps.clock.now().toISOString());
      return "delivered";
    }

    const rounds = due.attempts + 1;
    const delayMs = this.deps.retryDelaysMs[rounds - 1];
    if (delayMs === undefined) {
      for (const failure of failures) {
        await failure.consumer.deadLetter({
          messageId: entry.id,
          message,
          attempts: rounds,
          error: failure.error,
        });
      }
      // Marked only after every dead-letter record is written: if one of those writes throws, the
      // row stays pending and the next pass repeats the round instead of dropping the message.
      await this.deps.queue.markDelivered([entry.id], this.deps.clock.now().toISOString());
      return "dead-lettered";
    }

    await this.deps.queue.defer(
      entry.id,
      rounds,
      new Date(this.deps.clock.now().getTime() + delayMs).toISOString(),
    );
    this.deps.logger.warn("outbox delivery failed; row deferred", {
      messageId: entry.id,
      topic: entry.topic,
      tenantId: entry.headers["tenantId"],
      consumerGroups: failures.map((failure) => failure.consumer.consumerGroup),
      attempt: rounds,
      delayMs,
      error:
        failures[0]?.error instanceof Error
          ? failures[0].error.message
          : String(failures[0]?.error),
    });
    return "deferred";
  }
}
