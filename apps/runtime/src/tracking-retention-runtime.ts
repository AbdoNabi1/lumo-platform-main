import type { TrackingRetentionReport } from "@platform/tracking";
import type { RuntimeCore } from "./composition";

export interface TrackingRetentionHandle {
  stop(): void;
}

/** A pass runs for its own budget (4 minutes, `composition.ts`) plus work already in flight when it ends. */
const MIN_LOCK_TTL_MS = 6 * 60_000;

/** The shared name of the single-flight lock: one retention pass at a time across every worker. */
export const TRACKING_RETENTION_LOCK_KEY = "tracking-retention";

/**
 * Tracking P1-D10: the worker's timer for the privacy retention — anonymous visitor profiles deleted 400 days
 * after they were last seen, and the IP and user agent removed from event records older than 90 days. It runs in
 * the WORKER rather than the scheduler process because the worker is the process every deployment has (the
 * Railway guide does not deploy the scheduler), and a privacy promise must not depend on an optional process.
 *
 * On every tick it takes the `tracking-retention` lock (the same `RedisDistributedLock` the outbox relay and the
 * delivery-retry sweeper use) and runs one pass; another worker holding the lock is not a failure. The lock is
 * efficiency, not correctness: every statement the pass issues is idempotent, so two passes at once only repeat
 * work. Logs are counts only — no tenant, profile or event id.
 */
export function startTrackingRetention(
  core: RuntimeCore,
  run: () => Promise<TrackingRetentionReport>,
): TrackingRetentionHandle {
  const intervalMs = core.config.TRACKING_RETENTION_INTERVAL_MS;
  let passRunning = false;

  const tick = async (): Promise<void> => {
    if (passRunning) return; // a slow pass is not overlapped by the next tick
    passRunning = true;
    try {
      const handle = await core.distributedLock.acquire(
        TRACKING_RETENTION_LOCK_KEY,
        Math.max(intervalMs, MIN_LOCK_TTL_MS),
      );
      if (handle === null) return; // another worker is on it
      try {
        const report = await run();
        if (report.profilesDeleted > 0 || report.eventsRedacted > 0 || report.errored > 0) {
          core.logger.info("tracking retention pass", { ...report });
        }
      } finally {
        await handle.release();
      }
    } catch (error) {
      core.logger.error("tracking retention pass failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    } finally {
      passRunning = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}
