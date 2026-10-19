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

  async append(entry: OrderTimelineEntry, tenantId: string): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(entry.id, entry);
  }

  async listForOrder(
    orderId: string,
    tenantId: string,
    options: { readonly first: number },
  ): Promise<readonly OrderTimelineEntry[]> {
    const take = Math.max(1, Math.min(Math.trunc(options.first), TIMELINE_READ_LIMIT));
    return [...(this.store.get(tenantId)?.values() ?? [])]
      .filter((entry) => entry.orderId === orderId)
      .sort(newestFirst)
      .slice(0, take);
  }

  async findById(entryId: string, tenantId: string): Promise<OrderTimelineEntry | null> {
    return this.store.get(tenantId)?.get(entryId) ?? null;
  }

  async update(entry: OrderTimelineEntry, tenantId: string): Promise<void> {
    const bucket = this.store.get(tenantId);
    const current = bucket?.get(entry.id);
    if (bucket === undefined || current === undefined) return;
    bucket.set(entry.id, {
      ...current,
      body: entry.body,
      editedAt: entry.editedAt,
      deletedAt: entry.deletedAt,
    });
  }
}
