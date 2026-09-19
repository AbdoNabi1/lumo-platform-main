import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Cart } from "../domain/cart";
import type { CartListFilter, CartRepository } from "../domain/cart-repository";

export interface InMemoryCartRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `CartRepository`. Persists the aggregate and writes its events to the outbox on save. */
export class InMemoryCartRepository implements CartRepository {
  /** ADR-0014 (WP-10, T10.3): keyed by `(tenantId, cartId)`. */
  private readonly store = new Map<string, Map<string, Cart>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCartRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(cart: Cart, tenantId: string, tx?: unknown): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(cart.id.toString(), cart);
    await this.outbox.write(cart.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Cart | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  /** Last matching entry in insertion order wins when more than one exists (see the port doc comment). */
  async findBySessionRef(sessionRef: string, tenantId: string): Promise<Cart | null> {
    let match: Cart | null = null;
    for (const candidate of this.store.get(tenantId)?.values() ?? []) {
      if (candidate.sessionRef === sessionRef && candidate.status === "active") {
        match = candidate;
      }
    }
    return match;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(
    page: CursorPage,
    tenantId: string,
    filter?: CartListFilter,
  ): Promise<Paginated<Cart>> {
    const all = [...(this.store.get(tenantId)?.values() ?? [])]
      .filter((cart) => filter?.status === undefined || cart.status === filter.status)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
