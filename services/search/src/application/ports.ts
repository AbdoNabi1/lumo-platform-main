import type { SearchDocument } from "../domain/value-objects/search-document";

/** Outbound seam to the actual index backend (OpenSearch/pgvector, ADR-0020) — OpenSearch-agnostic, no duplicate index engine built here. */
export interface IndexProviderPort {
  upsert(document: SearchDocument): Promise<void>;
  delete(productRef: string): Promise<void>;
}
