import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Review } from "../domain/review";
import type { ReviewListFilter, ReviewRepository } from "../domain/review-repository";

export interface InMemoryReviewRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `ReviewRepository`. Persists the aggregate and writes events to the outbox on save.
 * ADR-0014 (WP-10, T10.3): keyed by `(tenantId, reviewId)` — `Review` carries no `tenantId` of its
 * own, so the store must key on it explicitly or a cross-tenant leak here would be invisible to
 * every isolation test.
 */
export class InMemoryReviewRepository implements ReviewRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly review: Review }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryReviewRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(review: Review, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(review.id.toString(), { tenantId, review });
    await this.outbox.write(review.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Review | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.review : null;
  }

  async findByCustomerAndProduct(
    customerRef: string,
    productRef: string,
    tenantId: string,
  ): Promise<Review | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        entry.review.customerRef === customerRef &&
        entry.review.productRef === productRef
      ) {
        return entry.review;
      }
    }
    return null;
  }

  async list(
    page: CursorPage,
    tenantId: string,
    filter?: ReviewListFilter,
  ): Promise<Paginated<Review>> {
    const rows = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.review)
      .filter((review) => filter?.status === undefined || review.status.value === filter.status);
    return this.paginate(rows, page);
  }

  async findByProductRef(
    productRef: string,
    page: CursorPage,
    tenantId: string,
  ): Promise<Paginated<Review>> {
    const rows = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId && entry.review.productRef === productRef)
      .map((entry) => entry.review);
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
