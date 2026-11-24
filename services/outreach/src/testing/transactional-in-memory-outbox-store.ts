import type { Clock } from "@platform/contracts";
import type { EventSerializer } from "@platform/domain-events";
import { type OutboxEntry, type OutboxStore, OutboxWriter } from "@platform/messaging";
import {
  OutboxOutreachEventSink,
  OutreachEventTranslator,
} from "../infrastructure/outbox-outreach-event-sink";

/**
 * An in-memory outbox that, unlike `InMemoryOutboxStore` (which ignores the transaction), honours the caller's
 * transaction like Postgres does: an append made with an in-memory outreach transaction handle is undone when that
 * transaction rolls back, so a rolled-back unit of work leaves NO outbox row. A call without such a handle is refused
 * (the production adapter appends only inside the caller's transaction too). Tests and local wiring only.
 */
export class TransactionalInMemoryOutboxStore implements OutboxStore<unknown> {
  private readonly entries: OutboxEntry[] = [];

  append(entries: readonly OutboxEntry[], tx: unknown): Promise<void> {
    const undo = (tx as { undo?: unknown } | null | undefined)?.undo;
    if (!Array.isArray(undo)) {
      return Promise.reject(new Error("the outbox append needs the caller's open transaction"));
    }
    this.entries.push(...entries);
    (undo as Array<() => void>).push(() => {
      for (const entry of entries) {
        const index = this.entries.indexOf(entry);
        if (index >= 0) this.entries.splice(index, 1);
      }
    });
    return Promise.resolve();
  }

  fetchPending(limit: number): Promise<readonly OutboxEntry[]> {
    return Promise.resolve(this.entries.filter((e) => e.status === "pending").slice(0, limit));
  }

  markPublished(ids: readonly string[], publishedAt: string): Promise<void> {
    const wanted = new Set(ids);
    for (const [index, entry] of this.entries.entries()) {
      if (entry.status === "pending" && wanted.has(entry.id)) {
        this.entries[index] = { ...entry, status: "published", publishedAt };
      }
    }
    return Promise.resolve();
  }

  /** The committed entries, oldest first. */
  snapshot(): readonly OutboxEntry[] {
    return [...this.entries];
  }
}

/** The production sink + translator + `OutboxWriter` over the transaction-aware in-memory outbox. */
export function createInMemoryOutboxEventSink(deps: {
  serializer: EventSerializer;
  clock: Clock;
}): {
  sink: OutboxOutreachEventSink;
  outbox: TransactionalInMemoryOutboxStore;
} {
  const outbox = new TransactionalInMemoryOutboxStore();
  const sink = new OutboxOutreachEventSink(
    new OutboxWriter({
      store: outbox,
      translator: new OutreachEventTranslator(),
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "outreach",
    }),
  );
  return { sink, outbox };
}
