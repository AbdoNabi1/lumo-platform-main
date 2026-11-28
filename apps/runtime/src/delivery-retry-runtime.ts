import type { RetrySweepReport } from "@platform/tracking";
import type { RuntimeCore } from "./composition";

export interface DeliveryRetryHandle {
  stop(): void;
}

/**
 * A pass can run for its own budget (4 minutes, `composition.ts`) plus the handlers already in flight
 * when it ends, so the lock outlives that; a crashed worker's successor waits at most this long.
 */
const MIN_LOCK_TTL_MS = 6 * 60_000;

/** The shared name of the single-flight lock: one sweeper at a time across every worker. */
export const DELIVERY_RETRY_LOCK_KEY = "tracking-delivery-retry";

/**
 * Tracking P1-D2: the worker's timer for the durable per-destination retry. On every tick it takes the
 * `tracking-delivery-retry` lock (the same `RedisDistributedLock` the outbox relay and the scheduler's
 * jobs use) and runs one `sweep` pass; another worker holding the lock is not a failure.
 *
 * The lock is efficiency, not correctness. If it is lost mid-pass, or Redis is unreachable and the pass
 * runs twice at once, the claim itself (`FOR UPDATE SKIP LOCKED` + a lease, `PrismaDeliveryRetryQueue`)
 * still hands each due row to exactly one sweeper, and a row is only ever re-sent under the unchanged
 * event id, which the vendor deduplicates.
 *
 * Runs under both `EVENT_TRANSPORT` values: parking and sweeping depend on the database, not on the
 * broker. Logs are counts only — the queue rows and these logs carry no payload and no identity.
 */
export function startDeliveryRetrySweep(
  core: RuntimeCore,
  sweep: () => Promise<RetrySweepReport>,
): DeliveryRetryHandle {
  const intervalMs = core.config.TRACKING_RETRY_SWEEP_INTERVAL_MS;
  let passRunning = false;

  const tick = async (): Promise<void> => {
    if (passRunning) return; // a slow pass is not overlapped by the next tick
    passRunning = true;
    try {
      const handle = await core.distributedLock.acquire(
        DELIVERY_RETRY_LOCK_KEY,
        Math.max(intervalMs * 2, MIN_LOCK_TTL_MS),
      );
      if (handle === null) return; // another worker is sweeping
      try {
        const report = await sweep();
        if (report.claimed > 0 || report.errored > 0) {
          core.logger.info("tracking delivery retry sweep", { ...report });
        }
      } finally {
        await handle.release();
      }
    } catch (error) {
      core.logger.error("tracking delivery retry sweep failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    } finally {
      passRunning = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}
