import type { OutboxEntry } from "./outbox-entry";
import type { OutboxStore } from "./outbox-store";

/**
 * In-memory `OutboxStore` for local development and tests. Ignores the transaction context. Not
 * for production (no durability) — production uses a Prisma adapter that appends within the
 * aggregate's transaction.
 */
export class InMemoryOutboxStore implements OutboxStore<unknown> {
  private readonly entries: OutboxEntry[] = [];

  async append(entries: readonly OutboxEntry[], _tx: unknown): Promise<void> {
    this.entries.push(...entries);
  }

  async fetchPending(limit: number): Promise<readonly OutboxEntry[]> {
    return this.entries.filter((entry) => entry.status === "pending").slice(0, limit);
  }

  async markPublished(ids: readonly string[], publishedAt: string): Promise<void> {
    const idSet = new Set(ids);
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index];
      if (entry !== undefined && entry.status === "pending" && idSet.has(entry.id)) {
        this.entries[index] = { ...entry, status: "published", publishedAt };
      }
    }
  }

  /** Test/inspection helper — a snapshot of all entries. */
  snapshot(): readonly OutboxEntry[] {
    return [...this.entries];
  }
}
