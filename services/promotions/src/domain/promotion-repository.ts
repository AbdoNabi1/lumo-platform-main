import type { CursorPage, Paginated } from "@platform/types";
import type { Promotion } from "./promotion";

/** Persistence port for {@link Promotion}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface PromotionRepository {
  save(promotion: Promotion, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Promotion | null>;
  /** Active promotions whose schedule may currently apply — the working set `evaluate()` is run over. */
  findActive(tenantId: string, tx?: unknown): Promise<readonly Promotion[]>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Promotion>>;
}
