import type { OrderNumberAllocator } from "../application/ports";
import { FIRST_ORDER_NUMBER } from "../domain/value-objects/order-number";

/** In-memory `OrderNumberAllocator`: one counter per shop, starting at {@link FIRST_ORDER_NUMBER}. */
export class InMemoryOrderNumberAllocator implements OrderNumberAllocator {
  private readonly lastByTenant = new Map<string, number>();

  next(tenantId: string): Promise<string> {
    const next = (this.lastByTenant.get(tenantId) ?? FIRST_ORDER_NUMBER - 1) + 1;
    this.lastByTenant.set(tenantId, next);
    return Promise.resolve(String(next));
  }
}
