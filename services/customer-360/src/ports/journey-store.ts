import type { DomainEvent } from "@platform/domain";
import type { SessionTransition } from "../domain/session-transition";

/**
 * Persistence port for the journey graph's edges (`SessionTransition`s) — append-only, same
 * discipline as `IdentityDecisionStore`. A distinct store from `SessionHistoryStore`: history is one
 * session's own snapshots; the journey store is the edges connecting *different* sessions, and
 * carries the explicit merge/split provenance FF-CDP-03 requires for the two explicit kinds.
 */
export interface JourneyStore {
  /** Persists one transition. `event` is supplied only for kinds that publish their own integration
   * event (`explicit_merge` → `SessionMerged`, `explicit_split` → `SessionSplit`); organic kinds
   * (`timed_out`, `device_changed`, `browser_restarted`, `manual_logout`, `resumed`,
   * `anonymous_to_identified`) are recorded silently here because the fact they describe is already
   * published via the paired `SessionHistoryStore.append` call (`SessionClosed`/`SessionStarted`/
   * `SessionUpdated`) — mirrors `IdentityGraphStore.appendEdge`'s optional-event shape exactly, for
   * the same "publish the fact exactly once" reason. */
  record(transition: SessionTransition, event?: DomainEvent, tx?: unknown): Promise<void>;
  /** Every transition naming this visitor, oldest first — the journey's own provenance trail. */
  listForVisitor(visitorId: string, tx?: unknown): Promise<readonly SessionTransition[]>;
}
