import type { CustomerSession } from "./customer-session";

/** Why a session snapshot was captured — mirrors `ProfileSnapshotReason`'s "kind describes
 * provenance" shape, with `merged`/`split` added for the two explicit corrections Session Stitching
 * supports that the Profile Engine does not. */
export type SessionSnapshotReason =
  "started" | "activity" | "closed" | "merged" | "split" | "rebuilt";

/**
 * An immutable, full capture of a {@link CustomerSession} at one version — the durable, append-only
 * ledger entry (`SessionHistoryStore`). Never edited or replaced; a later change is always a new
 * snapshot with a higher `version`. Full-session (not diff-only) capture, same tradeoff
 * `ProfileSnapshot` accepts: rebuild is "read the latest snapshot", nothing to fold.
 */
export interface SessionSnapshot {
  readonly sessionId: string;
  readonly visitorId: string;
  readonly deviceId?: string;
  readonly journeyId?: string;
  readonly source?: string;
  readonly status: CustomerSession["status"];
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly closedAt?: string;
  readonly closeReason?: CustomerSession["closeReason"];
  readonly pageCount: number;
  readonly version: number;
  readonly capturedAt: string;
  readonly reason: SessionSnapshotReason;
}

export function toSnapshot(
  session: CustomerSession,
  reason: SessionSnapshotReason,
  capturedAt: string,
): SessionSnapshot {
  return {
    sessionId: session.sessionId,
    visitorId: session.visitorId,
    deviceId: session.deviceId,
    journeyId: session.journeyId,
    source: session.source,
    status: session.status,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    closedAt: session.closedAt,
    closeReason: session.closeReason,
    pageCount: session.pageCount,
    version: session.version,
    capturedAt,
    reason,
  };
}

/** Reconstructs the current session view from the latest snapshot — the whole of "rebuild": each
 * snapshot already carries the full session state, so recovery never needs to fold history. */
export function fromSnapshot(snapshot: SessionSnapshot): CustomerSession {
  return {
    sessionId: snapshot.sessionId,
    visitorId: snapshot.visitorId,
    deviceId: snapshot.deviceId,
    journeyId: snapshot.journeyId,
    source: snapshot.source,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    lastActivityAt: snapshot.lastActivityAt,
    closedAt: snapshot.closedAt,
    closeReason: snapshot.closeReason,
    pageCount: snapshot.pageCount,
    version: snapshot.version,
  };
}
