import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Review } from "../domain/review";
import type { ReviewListFilter, ReviewRepository } from "../domain/review-repository";

export interface InMemoryReviewRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ReviewRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryReviewRepository implements ReviewRepository {
  private readonly store = new Map<string, Review>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryReviewRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(review: Review, tx?: unknown): Promise<void> {
    this.store.set(review.id.toString(), review);
    await this.outbox.write(review.pullDomainEvents(), this.context, tx);
  }

  /** ADR-0014: `tenantId` accepted for signature parity; this fake has no tenant partitioning. */
  async findById(id: string, _tenantId: string): Promise<Review | null> {
    return this.store.get(id) ?? null;
  }

  async findByCustomerAndProduct(
    customerRef: string,
    productRef: string,
    _tenantId: string,
  ): Promise<Review | null> {
    for (const review of this.store.values()) {
      if (review.customerRef === customerRef && review.productRef === productRef) return review;
    }
    return null;
  }

  async list(
    page: CursorPage,
    _tenantId: string,
    filter?: ReviewListFilter,
  ): Promise<Paginated<Review>> {
    const rows = [...this.store.values()].filter(
      (review) => filter?.status === undefined || review.status.value === filter.status,
    );
    return this.paginate(rows, page);
  }

  async findByProductRef(
    productRef: string,
    page: CursorPage,
    _tenantId: string,
  ): Promise<Paginated<Review>> {
    const rows = [...this.store.values()].filter((review) => review.productRef === productRef);
    return this.paginate(rows, page);
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  private paginate(rows: readonly Review[], page: CursorPage): Paginated<Review> {
    const sorted = [...rows].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : sorted.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : sorted.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
