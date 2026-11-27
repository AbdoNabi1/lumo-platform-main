/**
 * Durable retry schedule (Tracking P1-D2) — pure functions, no clock, no I/O.
 *
 * In-process retry (`deliver`, five tries over a few seconds) absorbs a blip. Anything longer — a
 * vendor outage, a deploy, an expired token the merchant fixes tomorrow — has to survive a restart,
 * so the delivery is parked in a durable queue and retried on this schedule until the VENDOR's own
 * window closes. The same `event_id` is sent every time, so a retry the vendor already accepted is
 * deduplicated on its side rather than counted twice.
 *
 * The windows are the vendors' documented limits on how old an event may be when it arrives:
 * - GA4 Measurement Protocol: events can be backdated up to 72 hours; older ones are accepted with a
 *   rewritten timestamp (RELAXED) — i.e. recorded on the wrong day, which is worse than not sending.
 * - Meta Conversions API, TikTok Events API, Snap Conversions API: 7 days. Meta rejects a whole batch
 *   that holds one older event, so the margin below keeps every retry well inside the limit.
 * Anything not listed gets GA4's window — the narrowest known — rather than an optimistic guess.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Delay before the next durable try, indexed by rounds already failed − 1 (the first failure waits one
 * minute). The last entry repeats until the vendor window closes.
 */
export const DURABLE_RETRY_BACKOFF_MS: readonly number[] = [
  1 * MINUTE,
  5 * MINUTE,
  30 * MINUTE,
  2 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
];

/** How much of a 7-day window is held back so a retry never lands on the vendor's edge. */
export const WINDOW_SAFETY_MARGIN_MS = HOUR;

/** The vendor window per destination `platform`, as milliseconds an event stays deliverable. */
export const VENDOR_WINDOW_MS: Readonly<Record<string, number>> = {
  ga4: 72 * HOUR,
  meta: 7 * DAY - WINDOW_SAFETY_MARGIN_MS,
  tiktok: 7 * DAY - WINDOW_SAFETY_MARGIN_MS,
  snap: 7 * DAY - WINDOW_SAFETY_MARGIN_MS,
};

/** Unknown platform: the narrowest window we know (GA4's), never a longer guess. */
export const DEFAULT_VENDOR_WINDOW_MS = VENDOR_WINDOW_MS["ga4"] as number;

export function vendorWindowMs(platform: string): number {
  return VENDOR_WINDOW_MS[platform] ?? DEFAULT_VENDOR_WINDOW_MS;
}

/** The instant after which a vendor will no longer take (or will mis-date) this event. */
export function windowExpiresAtMs(platform: string, eventTimestampMs: number): number {
  return eventTimestampMs + vendorWindowMs(platform);
}

/** Spread of the optional jitter: the delay becomes `delay × [0.8, 1.2)`. */
export const JITTER_RATIO = 0.2;

/** A final try is scheduled this long before the window closes, so it has room to run. */
const FINAL_TRY_LEAD_MS = 2 * MINUTE;
/** …and only if at least this much time remains, so two tries are never scheduled back to back. */
const MIN_FINAL_TRY_GAP_MS = 30_000;

export type NextRetry =
  | { readonly kind: "retry"; readonly atMs: number }
  /** No useful moment is left before the vendor window closes: dead-letter instead. */
  | { readonly kind: "window_closed" };

/**
 * When to try next, after `roundsFailed` failed rounds (the in-process batch is round 1).
 *
 * The regular slot is `now + backoff`; if that falls past the last useful moment, ONE final try is
 * placed just before the window closes (when there is time for it), so a long outage that ends late in
 * the window still gets its chance. After that try fails, `window_closed` ends the story.
 * `delayMs` overrides the backoff for a deferral that is not a vendor failure (an open circuit, an
 * empty token bucket): no vendor call was made, so the failure schedule is not advanced.
 */
export function planNextRetry(input: {
  readonly roundsFailed: number;
  readonly nowMs: number;
  readonly windowExpiresAtMs: number;
  readonly delayMs?: number;
  /**
   * Uniform `[0, 1)` source. When given, the delay is spread over ±{@link JITTER_RATIO} so a vendor
   * outage that failed thousands of deliveries in the same minute does not see them all come back in
   * the same second. Absent ⇒ the exact table value (what the schedule tests assert). The jittered
   * slot is still capped by the window: it can only land earlier than the final-try lead, never later.
   */
  readonly random?: () => number;
}): NextRetry {
  const index = Math.min(Math.max(input.roundsFailed, 1) - 1, DURABLE_RETRY_BACKOFF_MS.length - 1);
  const base = input.delayMs ?? DURABLE_RETRY_BACKOFF_MS[index] ?? HOUR;
  const delay =
    input.random === undefined
      ? base
      : Math.round(base * (1 - JITTER_RATIO + 2 * JITTER_RATIO * input.random()));
  const latest = input.windowExpiresAtMs - FINAL_TRY_LEAD_MS;
  const regular = input.nowMs + delay;

  if (regular <= latest) return { kind: "retry", atMs: regular };
  if (latest - input.nowMs >= MIN_FINAL_TRY_GAP_MS) return { kind: "retry", atMs: latest };
  return { kind: "window_closed" };
}
