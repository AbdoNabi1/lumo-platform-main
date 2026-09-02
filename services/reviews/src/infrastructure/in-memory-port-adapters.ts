import type { OrdersPort, ProcessedModerationStore } from "../application/ports";

/** Offline in-memory stub adapter for `OrdersPort`. Production swaps this for a real cross-context adapter at the composition root (deferred, per the report's own G-39 note). Defaults to "not purchased". */
export class InMemoryOrdersPort implements OrdersPort {
  private readonly purchases = new Set<string>();

  /** Test/demo seam — marks a `(customerRef, productRef)` pair as purchased. */
  markPurchased(customerRef: string, productRef: string): void {
    this.purchases.add(`${customerRef}:${productRef}`);
  }

  async hasPurchased(customerRef: string, productRef: string): Promise<boolean> {
    return this.purchases.has(`${customerRef}:${productRef}`);
  }
}

/** Replay-safe moderation-action dedup — in-memory `Set` keyed by `actionId`. Prisma-backed store supersedes this in production. */
export class InMemoryProcessedModerationStore implements ProcessedModerationStore {
  private readonly processed = new Set<string>();

  async hasProcessed(actionId: string): Promise<boolean> {
    return this.processed.has(actionId);
  }

  async markProcessed(actionId: string): Promise<void> {
    this.processed.add(actionId);
  }
}
