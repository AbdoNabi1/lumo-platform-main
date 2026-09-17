import type { CursorPage, Paginated } from "@platform/types";
import type { Review } from "./review";
import type { ReviewStatusValue } from "./value-objects/review-status";

export interface ReviewListFilter {
  readonly status?: ReviewStatusValue;
}

/**
 * Persistence port for {@link Review}. Implemented in infrastructure. The optional `tx` scopes the
 * call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter,
 * matching `services/catalog`'s shape. `Review` carries no `tenantId` of its own, so `save` takes
 * it as an explicit parameter (Option B) rather than reading it off the aggregate.
 */
export interface ReviewRepository {
  save(review: Review, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Review | null>;
  findByCustomerAndProduct(
    customerRef: string,
    productRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Review | null>;
  /** An optional `status` filter turns this into the moderation queue. */
  list(
    page: CursorPage,
    tenantId: string,
    filter?: ReviewListFilter,
    tx?: unknown,
  ): Promise<Paginated<Review>>;
  /** The customer-facing product page's read. */
  findByProductRef(
    productRef: string,
    page: CursorPage,
    tenantId: string,
    tx?: unknown,
  ): Promise<Paginated<Review>>;
}
