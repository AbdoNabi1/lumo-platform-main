import { PrismaOutboxDeliveryQueue } from "@platform/db";
import type { HealthCheck } from "@platform/health";
import { DEFAULT_RETRY_SCHEDULE } from "@platform/kafka";
import {
  OutboxDeliveryRelay,
  type DirectConsumer,
  type OutboxDeliveryQueue,
} from "@platform/messaging";
import type { RuntimeCore } from "./composition";

export interface OutboxDeliveryHandle {
  stop(): void;
  /** Readiness: unhealthy while the most recent pass failed (database unreachable, say). */
  healthCheck(): HealthCheck;
}

/**
 * A pass holds the lock for as long as its handlers take, which is not bounded by the poll
 * interval the way a Kafka publish is. A minute covers a full batch of slow handlers; a crashed
 * worker's successor waits at most that long before taking over.
 */
const MIN_LOCK_TTL_MS = 60_000;

/**
 * The broker-less event transport (`EVENT_TRANSPORT=postgres`): on a timer, hands every due
 * `platform.outbox` row to the consumers registered for its topic, in this process.
 *
 * It exists for a deployment that cannot run a Kafka-compatible broker. The producer side is
 * untouched — every repository still appends to the outbox inside its aggregate transaction
 * (ADR-0003) — and so are the consumers: the SAME runtimes the Kafka path builds are handed over
 * here, so a consumer added to the worker is delivered to under either transport without a second
 * registration. Inbox idempotency, the atomic handler path and the `platform.dead_letters` row
 * are all the consumer runtime's and behave identically.
 *
 * What is given up relative to Kafka, stated rather than implied:
 * - **No broker copy of anything.** No topic retention to replay from, no `.dlq` topic (the
 *   dead-letter ROW is still written), no consumer-group lag metric. The outbox table is the only
 *   record, and the scheduler prunes delivered rows after `OUTBOX_RETENTION_DAYS`.
 * - **One process does the work.** Delivery is sequential within a pass and single-flight across
 *   workers, so throughput is one row at a time. A second worker adds availability, not speed.
 * - **Nothing outside the outbox arrives.** The tracking collector publishes straight to the
 *   broker, so tracking ingest cannot run on this transport (`config.ts` refuses the combination).
 * - **A consumer registered later does not see earlier rows** — a row on a topic nobody subscribes
 *   to is marked delivered immediately.
 *
 * Single-flight: the same `outbox-relay` lock the Kafka relay uses (the two must never drain the
 * same table at once), plus an in-process guard so a slow pass is not overlapped by the next tick.
 * The lock is efficiency, not correctness (`RedisDistributedLock`): if it is lost mid-pass a second
 * worker redelivers, and the consumers' inboxes absorb it.
 */
export function startOutboxDelivery(
  core: RuntimeCore,
  consumers: readonly DirectConsumer[],
  queue: OutboxDeliveryQueue = new PrismaOutboxDeliveryQueue(core.prisma),
): OutboxDeliveryHandle {
  const relay = new OutboxDeliveryRelay({
    queue,
    consumers,
    clock: core.clock,
    logger: core.logger,
    retryDelaysMs: DEFAULT_RETRY_SCHEDULE.delaysMs,
    batchSize: core.config.OUTBOX_RELAY_BATCH_SIZE,
  });

  const intervalMs = core.config.OUTBOX_RELAY_INTERVAL_MS;
  let passRunning = false;
  let lastError: string | null = null;

  const tick = async (): Promise<void> => {
    if (passRunning) return;
    passRunning = true;
    try {
      const handle = await core.distributedLock.acquire(
        "outbox-relay",
        Math.max(intervalMs * 2, MIN_LOCK_TTL_MS),
      );
      if (handle === null) return; // another worker is draining — not a failure
      try {
        const report = await relay.drainOnce();
        const settled = report.delivered + report.unrouted + report.deadLettered;
        if (settled > 0 || report.deferred > 0) {
          core.logger.info("outbox delivery pass", { ...report });
        }
        if (settled > 0) core.metrics.recordOutboxPublished(settled);
        lastError = null;
      } finally {
        await handle.release();
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      core.logger.error("outbox delivery failed", { error: lastError });
      core.metrics.recordOutboxRelayFailure();
    } finally {
      passRunning = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);

  return {
    stop: () => clearInterval(timer),
    healthCheck: () => ({
      name: "outbox-delivery",
      probe: (): Promise<void> =>
        lastError === null
          ? Promise.resolve()
          : Promise.reject(new Error(`last delivery pass failed: ${lastError}`)),
    }),
  };
}
