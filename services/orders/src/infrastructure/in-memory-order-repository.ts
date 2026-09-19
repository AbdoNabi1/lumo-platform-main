import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { Paginated } from "@platform/types";
import type { Order } from "../domain/order";
import type { OrderListQuery, OrderRepository } from "../domain/order-repository";

export interface InMemoryOrderRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `OrderRepository`. Persists the aggregate and writes its events to the outbox on save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, orderId)`. */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly store = new Map<string, Map<string, Order>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryOrderRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(order: Order, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(order.id.toString(), order);
    await this.outbox.write(order.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Order | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  /** Most-recently-placed-first cursor page, mirroring `PrismaOrderRepository.list`'s `id desc` ordering. */
  async list(query: OrderListQuery, tenantId: string): Promise<Paginated<Order>> {
    const after = query.after !== undefined ? decodeCursor(query.after) : undefined;
    const limit = normalizePageSize(query.first);
    const sorted = [...(this.store.get(tenantId)?.values() ?? [])].sort((a, b) =>
      a.id.toString() < b.id.toString() ? 1 : -1,
    );
    const filtered = sorted.filter((order) => matchesQuery(order, query));
    const remaining =
      after !== undefined ? filtered.filter((order) => order.id.toString() < after) : filtered;
    return buildPaginatedPage(remaining.slice(0, limit + 1), limit, (order) => order.id.toString());
  }
}

function matchesQuery(order: Order, query: OrderListQuery): boolean {
  if (query.status !== undefined && order.status !== query.status) {
    return false;
  }
  if (query.search !== undefined) {
    const needle = query.search.trim().toLowerCase();
    const haystack = `${order.orderNumber.value} ${order.customerRef}`.toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }
  return true;
}
