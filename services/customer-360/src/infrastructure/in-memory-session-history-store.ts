import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { SessionSnapshot } from "../domain/session-snapshot";
import type { SessionHistoryStore } from "../ports/session-history-store";

export interface InMemorySessionHistoryStoreDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory adapter — dev/test only. Same outbox-write-on-append shape as
 * `InMemoryProfileHistoryStore` (same package, same convention), with one difference: `event` is
 * optional here — `RebuildSessions` appends with no event (see `SessionHistoryStore.append`'s doc
 * for why Phase 6.3 has no `session.rebuilt` event type). */
export class InMemorySessionHistoryStore implements SessionHistoryStore {
  private readonly snapshots: SessionSnapshot[] = [];
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySessionHistoryStoreDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async append(snapshot: SessionSnapshot, event?: DomainEvent, tx?: unknown): Promise<void> {
    this.snapshots.push(snapshot);
    if (event !== undefined) {
      await this.outbox.write([event], this.context, tx);
    }
  }

  async listFor(sessionId: string): Promise<readonly SessionSnapshot[]> {
    return this.snapshots.filter((snapshot) => snapshot.sessionId === sessionId);
  }

  async latestFor(sessionId: string): Promise<SessionSnapshot | null> {
    const rows = await this.listFor(sessionId);
    return rows.at(-1) ?? null;
  }
}
