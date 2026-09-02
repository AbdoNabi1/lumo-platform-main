import type { CartPort } from "../application/ports";

/**
 * Offline in-memory stub adapter for `CartPort`. Production swaps this for a real cross-context
 * adapter at the composition root (deferred, per the report's own G-39 note) — unchanged interface.
 */
export class InMemoryCartPort implements CartPort {
  private readonly added: { customerRef: string; productRef: string }[] = [];

  async addItem(customerRef: string, productRef: string): Promise<void> {
    this.added.push({ customerRef, productRef });
  }

  /** Test/demo seam — the items added so far. */
  get addedItems(): readonly { customerRef: string; productRef: string }[] {
    return this.added;
  }
}
