import type { ProcessedInteractionStore, SearchQueryPort } from "../application/ports";

/** Offline in-memory stub adapter for `SearchQueryPort`. Production swaps this for a real cross-context adapter at the composition root (deferred, per the report's own G-39 note). */
export class InMemorySearchQueryPort implements SearchQueryPort {
  private readonly relatedByProduct = new Map<string, readonly string[]>();

  /** Test/demo seam — seeds the related-products result for a product ref. */
  seedRelated(productRef: string, relatedRefs: readonly string[]): void {
    this.relatedByProduct.set(productRef, relatedRefs);
  }

  async getRelatedProducts(productRef: string): Promise<readonly string[]> {
    return this.relatedByProduct.get(productRef) ?? [];
  }
}

/** Replay-safe interaction-event dedup — in-memory `Set` keyed by `interactionId`. Prisma-backed store supersedes this in production. */
export class InMemoryProcessedInteractionStore implements ProcessedInteractionStore {
  private readonly processed = new Set<string>();

  async hasProcessed(interactionId: string): Promise<boolean> {
    return this.processed.has(interactionId);
  }

  async markProcessed(interactionId: string): Promise<void> {
    this.processed.add(interactionId);
  }
}
