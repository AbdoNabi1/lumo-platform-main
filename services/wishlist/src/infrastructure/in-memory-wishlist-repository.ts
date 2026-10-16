import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Wishlist } from "../domain/wishlist";
import type { WishlistRepository } from "../domain/wishlist-repository";

export interface InMemoryWishlistRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `WishlistRepository`. Persists the aggregate and writes events to the outbox on save.
 * ADR-0014 (WP-10, T10.3): keyed by `(tenantId, wishlistId)` — `Wishlist` carries no `tenantId` of
 * its own, so the store must key on it explicitly or a cross-tenant leak here would be invisible
 * to every isolation test.
 */
export class InMemoryWishlistRepository implements WishlistRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly wishlist: Wishlist }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryWishlistRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(wishlist: Wishlist, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(wishlist.id.toString(), { tenantId, wishlist });
    await this.outbox.write(wishlist.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Wishlist | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.wishlist : null;
  }

  async findByCustomerRef(customerRef: string, tenantId: string): Promise<Wishlist | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.wishlist.customerRef === customerRef) {
        return entry.wishlist;
      }
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, tenantId: string): Promise<Paginated<Wishlist>> {
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.wishlist)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
