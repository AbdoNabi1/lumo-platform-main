import type { IndexProviderPort } from "../application/ports";
import type { SearchDocument } from "../domain/value-objects/search-document";

/**
 * Offline in-memory stub adapter for `IndexProviderPort`. Production swaps this for the real
 * OpenSearch/pgvector adapter at the composition root (ADR-0020's own "inert until wired" note) —
 * unchanged interface.
 */
export class InMemoryIndexProvider implements IndexProviderPort {
  private readonly documents = new Map<string, SearchDocument>();

  async upsert(document: SearchDocument): Promise<void> {
    this.documents.set(document.productRef, document);
  }

  async delete(productRef: string): Promise<void> {
    this.documents.delete(productRef);
  }

  /** Test/demo seam — the documents indexed so far. */
  get indexedDocuments(): readonly SearchDocument[] {
    return [...this.documents.values()];
  }
}
