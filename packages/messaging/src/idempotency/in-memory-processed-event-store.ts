import type { ProcessedEventStore } from "./processed-event-store";

/**
 * In-memory `ProcessedEventStore` for local development and tests. `recordIfNew` is atomic within
 * this process (a single synchronous map check-and-set). Unbounded — not for production.
 */
export class InMemoryProcessedEventStore implements ProcessedEventStore {
  private readonly processed = new Map<string, string>();

  async has(messageId: string): Promise<boolean> {
    return this.processed.has(messageId);
  }

  async recordIfNew(messageId: string, processedAt: string, _tx?: unknown): Promise<boolean> {
    if (this.processed.has(messageId)) {
      return false;
    }
    this.processed.set(messageId, processedAt);
    return true;
  }
}
