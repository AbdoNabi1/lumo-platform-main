import type { SessionCloseReason } from "./session-boundary";
import type { SessionStatus } from "./session-status";
import { INITIAL_SESSION_VERSION, type SessionVersion } from "./session-version";

/**
 * The materialized session aggregate — one browser/device `session_id`'s own accumulated activity,
 * append-only (Rules: "Sessions are append-only. History is immutable. No destructive mutation.").
 * Keyed by `sessionId` (the raw `@platform/tracking` `session_id` identifier value) as a **plain
 * string**, not `@platform/tracking`'s `IdentifierType` union — same `domain-stays-pure` rule
 * `CustomerProfile` already documents: `domain/` may depend only on the shared kernel, never on
 * another bounded context's package. Ports and application code convert at the boundary.
 *
 * A `CustomerSession` is deliberately single-device/single-`session_id` scope — assembling the
 * cross-device *journey* (which sessions belong to the same person's continuous activity) is
 * `JourneyState`/`JourneySegment`'s job (`session-views.ts`), the same split `CustomerProfile` (one
 * identifier's own fields) vs. `mergeProfiles` (the 360 view) already establishes for Phase 6.2.
 */
export interface CustomerSession {
  readonly sessionId: string;
  readonly visitorId: string;
  readonly deviceId?: string;
  readonly journeyId?: string;
  /** Where the session's activity originates — `web` | `mobile_web` | `server` | `edge` on the
   * wire (`@platform/tracking`'s `EventSource`), carried here as a plain string for the same
   * domain-purity reason as every other cross-context reference in this file. */
  readonly source?: string;
  readonly status: SessionStatus;
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly closedAt?: string;
  readonly closeReason?: SessionCloseReason;
  /** Count of activity observations folded into this session (page views / events) — this
   * session's own tally, not a cross-context page-sequence number. */
  readonly pageCount: number;
  /** Bumped on every applied mutation (open, activity, close) — the session's own optimistic-read
   * version, same role as `CustomerProfile.version`. */
  readonly version: SessionVersion;
}

export interface OpenSessionInput {
  readonly sessionId: string;
  readonly visitorId: string;
  readonly deviceId?: string;
  readonly journeyId?: string;
  readonly source?: string;
  readonly startedAt: string;
}

export function openSession(input: OpenSessionInput): CustomerSession {
  return {
    sessionId: input.sessionId,
    visitorId: input.visitorId,
    deviceId: input.deviceId,
    journeyId: input.journeyId,
    source: input.source,
    status: "open",
    startedAt: input.startedAt,
    lastActivityAt: input.startedAt,
    pageCount: 1,
    version: INITIAL_SESSION_VERSION + 1,
  };
}

export interface RecordActivityResult {
  readonly session: CustomerSession;
  /** `false` when the incoming activity is at-or-before `lastActivityAt` — the same freshness
   * guard `applyFieldUpdate` uses, for the same reason: delivery is at-least-once and not
   * guaranteed ordered (doc 20 §1), so a late/replayed event must never move a session's clock
   * backwards. */
  readonly applied: boolean;
}

/**
 * Folds one more observed activity into an **open** session. Callers must check `status` before
 * calling — this function does not itself validate openness (see `ObserveSession`, which opens a
 * *new* session instead when the existing one is closed or past its idle window; see
 * `withinSessionWindow`). Append-only: returns a new value, never mutates `session`.
 */
export function recordActivity(session: CustomerSession, occurredAt: string): RecordActivityResult {
  if (occurredAt <= session.lastActivityAt) {
    return { session, applied: false };
  }
  return {
    applied: true,
    session: {
      ...session,
      lastActivityAt: occurredAt,
      pageCount: session.pageCount + 1,
      version: session.version + 1,
    },
  };
}

/**
 * Closes an open session — terminal; a closed session is never reopened (Rules: no destructive
 * mutation). `ResumeSession` always opens a *new* session instead, linked back by a
 * `SessionTransition`. Whether `session` is actually still open is the caller's (application
 * layer's) responsibility to check — the same division of labor `MergeIdentities`/`SplitIdentity`
 * use for their own input validation, kept out of this pure domain layer.
 */
export function closeSession(
  session: CustomerSession,
  reason: SessionCloseReason,
  occurredAt: string,
): CustomerSession {
  return {
    ...session,
    status: "closed",
    closedAt: occurredAt,
    closeReason: reason,
    version: session.version + 1,
  };
}
