import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor } from "@platform/repository";
import type { Paginated } from "@platform/types";
import type { Order } from "../domain/order";
import type { OrderListQuery, OrderRepository } from "../domain/order-repository";
import { matchesOrderSearch } from "../domain/order-search";
import { derivePaymentStatus, isOpenOrder } from "../domain/order-statuses";
import { orderPageSize } from "./order-list-where";

export interface InMemoryOrderRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `OrderRepository`. Persists the aggregate and writes its events to the outbox on save.
 * ADR-0014: keyed by `(tenantId, orderId)`. Order operations Part 1: the archive timestamp is kept
 * BESIDE the aggregate (like the `archived_at` column beside the Prisma row) and `save()` never touches
 * it; `InMemoryOrderAnnotationRepository` writes it through {@link writeArchivedAt}.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly store = new Map<string, Map<string, Order>>();
  private readonly archived = new Map<string, Map<string, Date>>();
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

  /** Every order of one shop: the source of the offline sales read model (`InMemorySalesSummaryQuery`). */
  ordersOf(tenantId: string): readonly Order[] {
    return [...(this.store.get(tenantId)?.values() ?? [])];
  }

  hasOrder(orderId: string, tenantId: string): boolean {
    return this.store.get(tenantId)?.has(orderId) === true;
  }

  archivedAtOf(orderId: string, tenantId: string): Date | null {
    return this.archived.get(tenantId)?.get(orderId) ?? null;
  }

  /** Sets (Date) or clears (null) the archive timestamp; false when this shop has no such order (an UPDATE that matched no row). */
  writeArchivedAt(orderId: string, tenantId: string, archivedAt: Date | null): boolean {
    if (!this.hasOrder(orderId, tenantId)) return false;
    let bucket = this.archived.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.archived.set(tenantId, bucket);
    }
    if (archivedAt === null) bucket.delete(orderId);
    else bucket.set(orderId, archivedAt);
    return true;
  }

  async findById(id: string, tenantId: string): Promise<Order | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  /** Most-recently-placed-first cursor page, mirroring `PrismaOrderRepository.list` predicate for predicate. */
  async list(query: OrderListQuery, tenantId: string): Promise<Paginated<Order>> {
    const after = query.after !== undefined ? decodeCursor(query.after) : undefined;
    const limit = orderPageSize(query.first);
    const sorted = this.ordersOf(tenantId)
      .slice()
      .sort((a, b) => (a.id.toString() < b.id.toString() ? 1 : -1));
    const filtered = sorted.filter((order) =>
      matchesQuery(order, query, this.archivedAtOf(order.id.toString(), tenantId)),
    );
    const remaining =
      after !== undefined ? filtered.filter((order) => order.id.toString() < after) : filtered;
    return buildPaginatedPage(remaining.slice(0, limit + 1), limit, (order) => order.id.toString());
  }
}

function matchesQuery(order: Order, query: OrderListQuery, archivedAt: Date | null): boolean {
  if (query.status !== undefined && order.status !== query.status) return false;
  if (query.search !== undefined && !matchesOrderSearch(order, query.search)) return false;
  if (query.archived !== undefined && (archivedAt !== null) !== query.archived) return false;
  if (query.open !== undefined && isOpenOrder(order.history) !== query.open) return false;
  if (
    query.paymentStatus !== undefined &&
    derivePaymentStatus(order.history) !== query.paymentStatus
  ) {
    return false;
  }
  if (query.ids !== undefined && !query.ids.includes(order.id.toString())) return false;
  const placedAt = order.history[0]?.occurredAt;
  if (query.createdFrom !== undefined && (placedAt === undefined || placedAt < query.createdFrom)) {
    return false;
  }
  if (query.createdTo !== undefined && (placedAt === undefined || placedAt >= query.createdTo)) {
    return false;
  }
  return true;
}
