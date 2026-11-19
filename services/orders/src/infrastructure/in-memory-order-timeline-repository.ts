import {
  TIMELINE_READ_LIMIT,
  type OrderTimelineEntry,
  type OrderTimelineRepository,
} from "../domain/order-timeline";

function newestFirst(a: OrderTimelineEntry, b: OrderTimelineEntry): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** In-memory {@link OrderTimelineRepository}, keyed by `(tenantId, entryId)`; mirrors the Prisma one. */
export class InMemoryOrderTimelineRepository implements OrderTimelineRepository {
  private readonly store = new Map<string, Map<string, OrderTimelineEntry>>();

  append(entry: OrderTimelineEntry, tenantId: string): Promise<void> {
    try {
      let bucket = this.store.get(tenantId);
      if (bucket === undefined) {
        bucket = new Map();
        this.store.set(tenantId, bucket);
      }
      bucket.set(entry.id, entry);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  listForOrder(
    orderId: string,
    tenantId: string,
    options: { readonly first: number },
  ): Promise<readonly OrderTimelineEntry[]> {
    try {
      const take = Math.max(1, Math.min(Math.trunc(options.first), TIMELINE_READ_LIMIT));
      return Promise.resolve(
        [...(this.store.get(tenantId)?.values() ?? [])]
          .filter((entry) => entry.orderId === orderId)
          .sort(newestFirst)
          .slice(0, take),
      );
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  findById(entryId: string, tenantId: string): Promise<OrderTimelineEntry | null> {
    try {
      return Promise.resolve(this.store.get(tenantId)?.get(entryId) ?? null);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  update(entry: OrderTimelineEntry, tenantId: string): Promise<void> {
    try {
      const bucket = this.store.get(tenantId);
      const current = bucket?.get(entry.id);
      if (bucket === undefined || current === undefined) return Promise.resolve();
      bucket.set(entry.id, {
        ...current,
        body: entry.body,
        editedAt: entry.editedAt,
        deletedAt: entry.deletedAt,
      });
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
