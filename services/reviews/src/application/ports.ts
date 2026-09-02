/** Outbound seam to Orders — Reviews never decides verified-purchase status itself. */
export interface OrdersPort {
  hasPurchased(customerRef: string, productRef: string): Promise<boolean>;
}

/** Replay-safe moderation-action dedup — unique per `(tenant, actionId)`, backing `ModerateReview`'s idempotency. */
export interface ProcessedModerationStore {
  hasProcessed(actionId: string): Promise<boolean>;
  markProcessed(actionId: string): Promise<void>;
}
