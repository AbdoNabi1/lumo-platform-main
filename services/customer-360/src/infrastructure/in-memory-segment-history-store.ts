import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { SegmentHistoryEntry } from "../domain/segment-history";
import type { IdentifierRef } from "../ports/identity-decision";
import type { SegmentHistoryStore } from "../ports/segment-history-store";
import { bucket } from "./tenant-seed";

export interface InMemorySegmentHistoryStoreDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory adapter — dev/test only. Same outbox-write-on-append shape as
 * `InMemoryAttributeHistoryStore`; `event` is optional (`RebuildSegmentMembership` has nothing new to
 * publish). */
export class InMemorySegmentHistoryStore implements SegmentHistoryStore {
  private readonly tenants = new Map<string, SegmentHistoryEntry[]>();

  private entries(tenantId: string): SegmentHistoryEntry[] {
    return bucket(this.tenants, tenantId, () => []);
  }
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemorySegmentHistoryStoreDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async append(
    entry: SegmentHistoryEntry,
    tenantId: string,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void> {
    this.entries(tenantId).push(entry);
    if (event !== undefined) {
      await this.outbox.write([event], this.context, tx);
    }
  }

  async listFor(
    identifier: IdentifierRef,
    segmentId: string,
    tenantId: string,
  ): Promise<readonly SegmentHistoryEntry[]> {
    return this.entries(tenantId).filter(
      (e) =>
        e.identifierType === identifier.type &&
        e.identifierValue === identifier.value &&
        e.segmentId === segmentId,
    );
  }

  async latestFor(
    identifier: IdentifierRef,
    segmentId: string,
    tenantId: string,
  ): Promise<SegmentHistoryEntry | null> {
    const rows = await this.listFor(identifier, segmentId, tenantId);
    return rows.at(-1) ?? null;
  }
}
