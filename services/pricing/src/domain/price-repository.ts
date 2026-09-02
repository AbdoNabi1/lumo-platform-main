import type { CursorPage, Paginated } from "@platform/types";
import type { Price } from "./price";

/** Persistence port for {@link Price}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface PriceRepository {
  save(price: Price, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Price | null>;
  /** Persists a price already marked deleted (via `Price.delete`) — same shape as `save` (Sprint 7.0). */
  delete(price: Price, tx?: unknown): Promise<void>;
  /** Cursor-paginated listing (Sprint 7.0). No `search` — no free-text field exists on `Price`. */
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Price>>;
  /**
   * Every published, non-deleted price for `productRef` in `currency` (Phase 3 Task 9, H-1) — the
   * authoritative lookup `PricingValidationPort`'s adapter uses instead of paging `list()` and
   * filtering in memory (the `first: 100` approach `apps/admin/src/http/pricing-resolution.ts`
   * already accepts as a disclosed limitation there, but must not be copied here). Backed by
   * `@@index([tenantId, productRef])` (`packages/db/prisma/schema/pricing.prisma:38`).
   *
   * Returns every match, not just one: Pricing has no invariant preventing more than one
   * concurrently-published price for the same product+currency (same gap `PriceBook.resolve()`/
   * `resolvePrice()` already handle) — callers apply their own "more than one ⇒ ambiguous" policy.
   */
  findPublishedByProduct(
    productRef: string,
    currency: string,
    tx?: unknown,
  ): Promise<readonly Price[]>;
}
