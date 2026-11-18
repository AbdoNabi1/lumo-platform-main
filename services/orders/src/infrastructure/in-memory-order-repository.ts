import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor } from "@platform/repository";
import type { Paginated } from "@platform/types";
import type { Order } from "../domain/order";
import type { OrderListQuery, OrderRepository } from "../domain/order-repository";
import { matchesOrderSearch } from "../domain/order-search";
import { derivePaymentStatus, isOpenOrder } from "../domain/order-statuses";
import { tagKeyOf, type OrderTag } from "../domain/order-tags";
import { orderPageSize } from "./order-list-where";

export interface InMemoryOrderRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

interface StoredTag extends OrderTag {
  /** Insertion order across the store — the in-memory twin of `created_at` ("first spelling wins"). */
  readonly seq: number;
}

function bucketOf<V>(store: Map<string, Map<string, V>>, tenantId: string): Map<string, V> {
  let bucket = store.get(tenantId);
  if (bucket === undefined) {
    bucket = new Map();
    store.set(tenantId, bucket);
  }
  return bucket;
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
  private readonly notes = new Map<string, Map<string, string>>();
  private readonly tags = new Map<string, Map<string, StoredTag[]>>();
  private tagSeq = 0;
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

  noteOf(orderId: string, tenantId: string): string | null {
    return this.notes.get(tenantId)?.get(orderId) ?? null;
  }

  /** Sets or clears the note; false when this shop has no such order (an UPDATE that matched no row). */
  writeNote(orderId: string, tenantId: string, note: string | null): boolean {
    if (!this.hasOrder(orderId, tenantId)) return false;
    const bucket = bucketOf(this.notes, tenantId);
    if (note === null) bucket.delete(orderId);
    else bucket.set(orderId, note);
    return true;
  }

  tagsOf(orderId: string, tenantId: string): readonly OrderTag[] {
    return (this.tags.get(tenantId)?.get(orderId) ?? []).map(({ tag, tagKey }) => ({
      tag,
      tagKey,
    }));
  }

  /** Replaces the order's whole tag set; a key it already had keeps its first spelling and time. */
  writeTags(orderId: string, tenantId: string, next: readonly OrderTag[]): boolean {
    if (!this.hasOrder(orderId, tenantId)) return false;
    const bucket = bucketOf(this.tags, tenantId);
    const current = new Map((bucket.get(orderId) ?? []).map((row) => [row.tagKey, row]));
    bucket.set(
      orderId,
      next.map((tag) => current.get(tag.tagKey) ?? { ...tag, seq: (this.tagSeq += 1) }),
    );
    return true;
  }

  /** Every tag row of one shop, with its order and write order (the source of `tagsInUse`). */
  tagRowsOf(tenantId: string): readonly {
    readonly orderId: string;
    readonly tag: string;
    readonly tagKey: string;
    readonly seq: number;
  }[] {
    return [...(this.tags.get(tenantId)?.entries() ?? [])].flatMap(([orderId, rows]) =>
      rows.map((row) => ({ orderId, ...row })),
    );
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
    const filtered = sorted.filter((order) => {
      const id = order.id.toString();
      return matchesQuery(order, query, {
        archivedAt: this.archivedAtOf(id, tenantId),
        tagKeys: new Set(this.tagsOf(id, tenantId).map((tag) => tag.tagKey)),
      });
    });
    const remaining =
      after !== undefined ? filtered.filter((order) => order.id.toString() < after) : filtered;
    return buildPaginatedPage(remaining.slice(0, limit + 1), limit, (order) => order.id.toString());
  }
}

function matchesQuery(
  order: Order,
  query: OrderListQuery,
  beside: { readonly archivedAt: Date | null; readonly tagKeys: ReadonlySet<string> },
): boolean {
  const archivedAt = beside.archivedAt;
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
  if (query.tags !== undefined) {
    const wanted = query.tags.map(tagKeyOf).filter((key) => key.length > 0);
    if (!wanted.every((key) => beside.tagKeys.has(key))) return false;
  }
  return true;
}
