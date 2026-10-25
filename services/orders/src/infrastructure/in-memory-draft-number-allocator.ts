import type { DraftNumberAllocator } from "../domain/draft-order-repository";

/** In-memory `DraftNumberAllocator`: one counter per shop, D1 first. */
export class InMemoryDraftNumberAllocator implements DraftNumberAllocator {
  private readonly lastByTenant = new Map<string, number>();

  next(tenantId: string): Promise<string> {
    const next = (this.lastByTenant.get(tenantId) ?? 0) + 1;
    this.lastByTenant.set(tenantId, next);
    return Promise.resolve(`D${next}`);
  }
}
