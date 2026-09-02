/**
 * Broker-side redelivery schedule (Sprint 2.5, replaces in-process sleep retries per the
 * ADR-0005 note / gap G-9): a failed message is republished to `<topic>.retry` with a due time;
 * the retry consumer waits until due, so the MAIN topic never head-of-line blocks. Pure and
 * injectable for deterministic tests.
 */
export interface RetrySchedule {
  /** Delays per attempt (1-based); `delays.length` is the max attempt count before DLQ. */
  readonly delaysMs: readonly number[];
}

/** Default production schedule: 5s → 30s → 2m → 10m → 1h, then DLQ. */
export const DEFAULT_RETRY_SCHEDULE: RetrySchedule = {
  delaysMs: [5_000, 30_000, 120_000, 600_000, 3_600_000],
};

export function maxAttempts(schedule: RetrySchedule): number {
  return schedule.delaysMs.length;
}

/** Delay before the given 1-based retry attempt; throws on out-of-range (programming error). */
export function delayForAttempt(schedule: RetrySchedule, attempt: number): number {
  const delay = schedule.delaysMs[attempt - 1];
  if (delay === undefined) {
    throw new Error(`RetrySchedule: attempt ${attempt} exceeds max ${maxAttempts(schedule)}`);
  }
  return delay;
}
