import type { DeadLetterEntry, DeadLetterStore } from "./dead-letter-store";

/** In-memory `DeadLetterStore` for local development and tests. Not for production. */
export class InMemoryDeadLetterStore implements DeadLetterStore {
  private readonly entries: DeadLetterEntry[] = [];

  async add(entry: DeadLetterEntry): Promise<void> {
    this.entries.push(entry);
  }

  /** Test/inspection helper — a snapshot of dead-lettered entries. */
  snapshot(): readonly DeadLetterEntry[] {
    return [...this.entries];
  }
}
