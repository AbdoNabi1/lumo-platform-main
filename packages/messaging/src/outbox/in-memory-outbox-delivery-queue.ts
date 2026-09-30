import type { DueOutboxEntry, OutboxDeliveryQueue } from "./outbox-delivery-relay";
import type { OutboxEntry } from "./outbox-entry";

interface Row {
  entry: OutboxEntry;
  attempts: number;
  availableAt: string | null;
}

/**
 * In-memory `OutboxDeliveryQueue` for local composition and tests. Honours the port contract the
 * Prisma adapter has to: insertion order, waiting rows neither returned nor counted against the
 * limit, and `markDelivered`/`defer` acting only on rows still pending.
 */
export class InMemoryOutboxDeliveryQueue implements OutboxDeliveryQueue {
  private readonly rows: Row[] = [];

  /** Test/local seam: the producer side appends through `OutboxStore`; this queue starts empty. */
  enqueue(entries: readonly OutboxEntry[]): void {
    for (const entry of entries) this.rows.push({ entry, attempts: 0, availableAt: null });
  }

  fetchDue(limit: number, now: string): Promise<readonly DueOutboxEntry[]> {
    const nowMs = Date.parse(now);
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.entry.status === "pending" &&
            (row.availableAt === null || Date.parse(row.availableAt) <= nowMs),
        )
        .slice(0, limit)
        .map((row) => ({ entry: row.entry, attempts: row.attempts })),
    );
  }

  markDelivered(ids: readonly string[], deliveredAt: string): Promise<void> {
    for (const row of this.rows) {
      if (ids.includes(row.entry.id) && row.entry.status === "pending") {
        row.entry = { ...row.entry, status: "published", publishedAt: deliveredAt };
      }
    }
    return Promise.resolve();
  }

  defer(id: string, attempts: number, availableAt: string): Promise<void> {
    for (const row of this.rows) {
      if (row.entry.id === id && row.entry.status === "pending") {
        row.attempts = attempts;
        row.availableAt = availableAt;
      }
    }
    return Promise.resolve();
  }

  snapshot(): readonly { entry: OutboxEntry; attempts: number; availableAt: string | null }[] {
    return this.rows.map((row) => ({ ...row }));
  }
}
