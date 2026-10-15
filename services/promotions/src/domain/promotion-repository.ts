import type { CursorPage, Paginated } from "@platform/types";
import type { Promotion } from "./promotion";

/** The admin Discounts list's query (Phase 2): Shopify's tabs, search by title, plus ids found by code. */
export interface AdminPromotionQuery extends CursorPage {
  readonly view: "all" | "active" | "scheduled" | "expired";
  /** Case-insensitive part of the title. */
  readonly search?: string;
  /** Promotions to include whatever their title — the ones whose code matched the search. */
  readonly alsoIds?: readonly string[];
  readonly now: Date;
}

/** Persistence port for {@link Promotion}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface PromotionRepository {
  save(promotion: Promotion, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Promotion | null>;
  /** Active promotions whose schedule may currently apply — the working set `evaluate()` is run over. */
  findActive(tenantId: string, tx?: unknown): Promise<readonly Promotion[]>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Promotion>>;
  /** Active promotions applied without a code — what checkout evaluates automatically. */
  findActiveAutomatic(tenantId: string, tx?: unknown): Promise<readonly Promotion[]>;
  /** Newest first; never archived. */
  listForAdmin(
    query: AdminPromotionQuery,
    tenantId: string,
    tx?: unknown,
  ): Promise<Paginated<Promotion>>;
}
