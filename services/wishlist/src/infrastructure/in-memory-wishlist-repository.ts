import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Wishlist } from "../domain/wishlist";
import type { WishlistRepository } from "../domain/wishlist-repository";

export interface InMemoryWishlistRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `WishlistRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryWishlistRepository implements WishlistRepository {
  private readonly store = new Map<string, Wishlist>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryWishlistRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(wishlist: Wishlist, tx?: unknown): Promise<void> {
    this.store.set(wishlist.id.toString(), wishlist);
    await this.outbox.write(wishlist.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Wishlist | null> {
    return this.store.get(id) ?? null;
  }

  async findByCustomerRef(customerRef: string): Promise<Wishlist | null> {
    for (const wishlist of this.store.values()) {
      if (wishlist.customerRef === customerRef) return wishlist;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage): Promise<Paginated<Wishlist>> {
    const all = [...this.store.values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
