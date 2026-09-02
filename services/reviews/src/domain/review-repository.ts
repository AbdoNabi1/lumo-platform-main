import type { CursorPage, Paginated } from "@platform/types";
import type { Review } from "./review";
import type { ReviewStatusValue } from "./value-objects/review-status";

export interface ReviewListFilter {
  readonly status?: ReviewStatusValue;
}

/** Persistence port for {@link Review}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface ReviewRepository {
  save(review: Review, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Review | null>;
  findByCustomerAndProduct(
    customerRef: string,
    productRef: string,
    tx?: unknown,
  ): Promise<Review | null>;
  /** An optional `status` filter turns this into the moderation queue. */
  list(page: CursorPage, filter?: ReviewListFilter, tx?: unknown): Promise<Paginated<Review>>;
  /** The customer-facing product page's read. */
  findByProductRef(productRef: string, page: CursorPage, tx?: unknown): Promise<Paginated<Review>>;
}
