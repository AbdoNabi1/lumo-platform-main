import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { SessionSnapshot } from "../domain/session-snapshot";
import type { SessionHistoryStore } from "../ports/session-history-store";
import { bucket } from "./tenant-seed";

export interface InMemorySessionHistoryStoreDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory adapter — dev/test only. Same outbox-write-on-append shape as
 * `InMemoryProfileHistoryStore` (same package, same convention), with one difference: `event` is
 * optional here — `RebuildSessions` appends with no event (see `SessionHistoryStore.append`'s doc
 * for why Phase 6.3 has no `session.rebuilt` event type). */
export class InMemorySessionHistoryStore implements SessionHistoryStore {
  private readonly tenants = new Map<string, SessionSnapshot[]>();

  private snapshots(tenantId: string): SessionSnapshot[] {
    return bucket(this.tenants, tenantId, () => []);
  }
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySessionHistoryStoreDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async append(
    snapshot: SessionSnapshot,
    tenantId: string,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    this.snapshots(tenantId).push(snapshot);
    if (event !== undefined) {
      await this.outbox.write([event], this.context, tx);
    }
  }

  async listFor(sessionId: string, tenantId: string): Promise<readonly SessionSnapshot[]> {
    return this.snapshots(tenantId).filter((snapshot) => snapshot.sessionId === sessionId);
  }

  async latestFor(sessionId: string, tenantId: string): Promise<SessionSnapshot | null> {
    const rows = await this.listFor(sessionId, tenantId);
    return rows.at(-1) ?? null;
  }
}
