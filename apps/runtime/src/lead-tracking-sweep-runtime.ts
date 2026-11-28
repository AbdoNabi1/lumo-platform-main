import type { RuntimeCore } from "./composition";

export interface LeadTrackingSweepHandle {
  stop(): void;
}

/** What a pass reports; counts only (no lead data reaches a log). */
export interface LeadTrackingSweepCounts {
  readonly tenants: number;
  readonly scanned: number;
  readonly sent: number;
  readonly expired: number;
  readonly errored: number;
}

/**
 * A pass can run for its own budget (4 minutes, `SweepPendingLeadTracking`) plus the send already in flight when it
 * ends, so the lock outlives that; a crashed worker's successor waits at most this long.
 */
const MIN_LOCK_TTL_MS = 6 * 60_000;

/** The single-flight lock of the lead sweeper: one sweeper at a time across every worker, apart from the delivery retry's. */
export const LEAD_TRACKING_LOCK_KEY = "tracking-lead-sweep";

/**
 * Tracking P2-D9: the worker's timer for the lead tracking sweeper — the same scheduler + lock shape as
 * `startDeliveryRetrySweep`. On every tick it takes the `tracking-lead-sweep` lock (the `RedisDistributedLock` the
 * outbox relay and the other sweepers use) and runs one pass; another worker holding the lock is not a failure. The
 * interval is the delivery retry's (`TRACKING_RETRY_SWEEP_INTERVAL_MS`, one minute by default): the sweeper only acts
 * on leads older than two minutes, so no second knob is needed.
 *
 * The lock is efficiency, not correctness. If it is lost mid-pass, or Redis is unreachable and two passes run at once,
 * every send is still one event (the outbox row is keyed by the lead's derived message id) and the settle is a
 * conditional `pending -> sent` update that only one of them wins.
 *
 * Runs under both `EVENT_TRANSPORT` values: it depends on the database, not on the broker. Logs are counts only.
 */
export function startLeadTrackingSweep(
  core: RuntimeCore,
  sweep: () => Promise<LeadTrackingSweepCounts>,
): LeadTrackingSweepHandle {
  const intervalMs = core.config.TRACKING_RETRY_SWEEP_INTERVAL_MS;
  let passRunning = false;

  const tick = async (): Promise<void> => {
    if (passRunning) return; // a slow pass is not overlapped by the next tick
    passRunning = true;
    try {
      const handle = await core.distributedLock.acquire(
        LEAD_TRACKING_LOCK_KEY,
        Math.max(intervalMs * 2, MIN_LOCK_TTL_MS),
      );
      if (handle === null) return; // another worker is sweeping
      try {
        const report = await sweep();
        if (report.scanned > 0 || report.errored > 0) {
          core.logger.info("lead tracking sweep", { ...report });
        }
      } finally {
        await handle.release();
      }
    } catch (error) {
      core.logger.error("lead tracking sweep failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    } finally {
      passRunning = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(timer) };
}
