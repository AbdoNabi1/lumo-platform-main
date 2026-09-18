import type { CustomerSession } from "../domain/customer-session";

/**
 * Persistence port for the **current** materialized session — a rebuildable serving cache, not the
 * source of truth (`SessionHistoryStore` is). Same rebuildable-cache contract `ProfileStore`
 * documents for Phase 6.2 — losing or corrupting a row here is recoverable by `RebuildSessions`,
 * never a data-loss event.
 */
export interface SessionStore {
  getCurrent(sessionId: string, tenantId: string, tx?: unknown): Promise<CustomerSession | null>;
  /** Upsert — replaces whatever was cached for this session id. Safe only because this store is a
   * disposable projection; never call this expecting append-only semantics (use
   * `SessionHistoryStore.append` for the durable record). */
  saveCurrent(session: CustomerSession, tenantId: string, tx?: unknown): Promise<void>;
  /** Every open session belonging to this visitor — how `ResolveCurrentSession` finds the
   * most-recently-active one across a visitor's own sessions. Single-identifier scope; cross-device
   * resolution is layered on top via Identity Engine's `ResolveIdentity`, never reimplemented here. */
  listOpenForVisitor(
    visitorId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CustomerSession[]>;
  /** Every session belonging to this visitor, open or closed — `GetJourneyTimeline`/`GetJourneyState`
   * need the full set, not just the open ones. */
  listForVisitor(
    visitorId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CustomerSession[]>;
  /** Every known session id — how `SessionProjectionWorker` finds what to rebuild without needing a
   * separate registry (mirrors `ProfileStore.listIdentifiers`). */
  listSessionIds(tenantId: string, tx?: unknown): Promise<readonly string[]>;
}
