import type { CustomerSession } from "./customer-session";
import type { SessionTransition, SessionTransitionKind } from "./session-transition";

/** Elapsed time between a session's start and its last known activity (its close time, if closed;
 * otherwise its most recent activity) — milliseconds. Never negative in practice: every domain
 * mutation in `customer-session.ts` preserves `startedAt <= lastActivityAt`. */
export function sessionDuration(session: CustomerSession): number {
  const end = session.closedAt ?? session.lastActivityAt;
  return Date.parse(end) - Date.parse(session.startedAt);
}

/**
 * Whether a session should still be considered live as of `now` — open, and not yet past the idle
 * timeout. A session whose window has silently expired (no `ObserveSession` call has run to close
 * it yet — closing is lazy, on next observed activity, not a background sweep; see
 * `docs/platform/SESSION_MODEL.md`'s deferred-work section) is reported inactive here even though
 * its stored `status` still says `"open"` — the two can disagree until the next write touches it.
 */
export function isActive(session: CustomerSession, now: string, timeoutMs: number): boolean {
  if (session.status === "closed") return false;
  const idleMs = Date.parse(now) - Date.parse(session.lastActivityAt);
  return idleMs >= 0 && idleMs <= timeoutMs;
}

/**
 * One leg of a customer's cross-session journey — a single `SessionTransition` enriched with the
 * gap it spans. Distinct from a marketing "segment" (Growth's audience Segments, explicitly out of
 * scope for Phase 6.3 per the brief): this is a structural edge in the journey graph, not a cohort
 * of customers.
 */
export interface JourneySegment {
  readonly transition: SessionTransition;
  /** Milliseconds between the closing session's last activity and the opening session's start —
   * `undefined` when either endpoint session is missing from the supplied set (a transition can be
   * read before both its endpoint snapshots are loaded; callers should not treat this as an
   * error). */
  readonly gapMs?: number;
}

/** Builds one {@link JourneySegment} per transition, resolving each transition's endpoint sessions
 * from the supplied set. Pure — does not query storage; `GetJourneyTimeline` supplies both
 * collections already loaded. */
export function journeySegments(
  sessions: readonly CustomerSession[],
  transitions: readonly SessionTransition[],
): readonly JourneySegment[] {
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  return transitions.map((transition) => {
    const from =
      transition.fromSessionId !== undefined ? byId.get(transition.fromSessionId) : undefined;
    const to = transition.toSessionId !== undefined ? byId.get(transition.toSessionId) : undefined;
    const gapMs =
      from !== undefined && to !== undefined
        ? Date.parse(to.startedAt) - Date.parse(from.closedAt ?? from.lastActivityAt)
        : undefined;
    return { transition, gapMs };
  });
}

const IDENTIFYING_TRANSITION_KINDS: readonly SessionTransitionKind[] = ["anonymous_to_identified"];

/**
 * A visitor's current position in their own journey — session count, which session (if any) is
 * currently open, journey span, and whether an `anonymous_to_identified` transition has ever been
 * observed. `identified` is derived purely from this journey's own transition history, never by
 * re-deriving identity confidence (that stays Identity Engine's job — the "never duplicate Identity
 * Graph" rule).
 */
export interface JourneyState {
  readonly visitorId: string;
  readonly sessionCount: number;
  readonly currentSessionId?: string;
  readonly firstSeenAt?: string;
  readonly lastActivityAt?: string;
  readonly identified: boolean;
}

export function journeyState(
  visitorId: string,
  sessions: readonly CustomerSession[],
  transitions: readonly SessionTransition[],
): JourneyState {
  if (sessions.length === 0) {
    return { visitorId, sessionCount: 0, identified: false };
  }

  const byStart = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const byActivity = [...sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const mostRecentlyActive = byActivity[0];
  const current = mostRecentlyActive?.status === "open" ? mostRecentlyActive : undefined;

  return {
    visitorId,
    sessionCount: sessions.length,
    currentSessionId: current?.sessionId,
    firstSeenAt: byStart[0]?.startedAt,
    lastActivityAt: mostRecentlyActive?.lastActivityAt,
    identified: transitions.some((transition) =>
      IDENTIFYING_TRANSITION_KINDS.includes(transition.kind),
    ),
  };
}
