/**
 * The idle-gap threshold beyond which a session is considered over — the common CDP/analytics
 * default (30 minutes) chosen because Phase 6.3 has no per-tenant configuration surface yet
 * (no speculative configuration knobs; a tenant-configurable timeout is explicitly deferred, see
 * `docs/platform/SESSION_MODEL.md`'s deferred-work section).
 */
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Whether an activity observed at `occurredAt` still belongs to a session whose last activity was
 * `lastActivityAt`, or the idle gap has exceeded the timeout and a new session boundary should be
 * drawn. Pure math over two instants — `ObserveSession` is the only caller that turns a `false`
 * result into an actual close+open (this function only answers the yes/no question). A negative
 * gap (an out-of-order/replayed event older than the session's last activity) is also reported as
 * "not within window" — `recordActivity`'s own freshness guard is what actually rejects it; this
 * function just must not claim a stale event extends the window.
 */
export function withinSessionWindow(
  lastActivityAt: string,
  occurredAt: string,
  timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
): boolean {
  const gapMs = Date.parse(occurredAt) - Date.parse(lastActivityAt);
  return gapMs >= 0 && gapMs <= timeoutMs;
}
