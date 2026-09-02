import type { DomainEvent } from "@platform/domain";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { AttributeSnapshot } from "../domain/attribute-snapshot";
import type { AttributeHistoryStore } from "../ports/attribute-history-store";
import type { IdentifierRef } from "../ports/identity-decision";

export interface InMemoryAttributeHistoryStoreDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory adapter — dev/test only. Same outbox-write-on-append shape as
 * `InMemoryProfileHistoryStore` (same package, same convention); `event` is optional (mirrors
 * `SessionHistoryStore`'s own divergence — `RebuildComputedAttributes` has nothing new to publish). */
export class InMemoryAttributeHistoryStore implements AttributeHistoryStore {
  private readonly snapshots: AttributeSnapshot[] = [];
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryAttributeHistoryStoreDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async append(snapshot: AttributeSnapshot, event?: DomainEvent, tx?: unknown): Promise<void> {
    this.snapshots.push(snapshot);
    if (event !== undefined) {
      await this.outbox.write([event], this.context, tx);
    }
  }

  async listFor(identifier: IdentifierRef): Promise<readonly AttributeSnapshot[]> {
    return this.snapshots.filter(
      (s) => s.identifierType === identifier.type && s.identifierValue === identifier.value,
    );
  }

  async latestFor(identifier: IdentifierRef): Promise<AttributeSnapshot | null> {
    const rows = await this.listFor(identifier);
    return rows.at(-1) ?? null;
  }
}
