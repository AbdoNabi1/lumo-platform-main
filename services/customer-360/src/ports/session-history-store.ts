import type { DomainEvent } from "@platform/domain";
import type { SessionSnapshot } from "../domain/session-snapshot";

/**
 * Persistence port for the session ledger — the durable source of truth `SessionStore`'s cache is
 * rebuilt from. Append-only, same discipline as `ProfileHistoryStore`: a snapshot is never updated
 * or deleted, only appended.
 */
export interface SessionHistoryStore {
  /** Persists one snapshot. `event`, when supplied, is written to the outbox in the same unit of
   * work — mirrors `ProfileHistoryStore.append`'s shape, with one deliberate difference: `event` is
   * **optional** here (`ProfileHistoryStore.append`'s is not), because Phase 6.3's event catalog is
   * fixed at exactly five types (`started`/`updated`/`closed`/`merged`/`split` — no
   * `session.rebuilt`); `RebuildSessions` appends a `reason: "rebuilt"` snapshot for its own audit
   * trail without inventing a sixth event type to publish. Mirrors `IdentityGraphStore.appendEdge`'s
   * optional-event shape for the same reason: not every durable write is also a published fact. */
  append(
    snapshot: SessionSnapshot,
    tenantId: string,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void>;
  /** Every snapshot for this session, oldest first — the session's own history/provenance trail. */
  listFor(sessionId: string, tenantId: string, tx?: unknown): Promise<readonly SessionSnapshot[]>;
  /** The most recent snapshot only — `RebuildSessions` needs just this (each snapshot is a full
   * capture, so replay-from-latest is sufficient; see `session-snapshot.ts`). `null` when the
   * session has no history yet. */
  latestFor(sessionId: string, tenantId: string, tx?: unknown): Promise<SessionSnapshot | null>;
}
