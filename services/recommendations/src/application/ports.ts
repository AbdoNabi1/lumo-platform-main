/** Outbound seam to Search — Recommendations computes over the shared index, never a duplicate one. */
export interface SearchQueryPort {
  getRelatedProducts(productRef: string): Promise<readonly string[]>;
}

/** Replay-safe interaction-event dedup — backs event-driven `GenerateRecommendationSet`'s idempotency. */
export interface ProcessedInteractionStore {
  hasProcessed(interactionId: string): Promise<boolean>;
  markProcessed(interactionId: string): Promise<void>;
}
