import type { CursorPage, Paginated } from "@platform/types";
import type { PricingRule } from "./pricing-rule";

/** Persistence port for {@link PricingRule}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface PricingRuleRepository {
  save(rule: PricingRule, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<PricingRule | null>;
  /** Cursor-paginated listing (Sprint 7.0). No `delete` — superseded by `active`/`deactivate()`. */
  list(page: CursorPage, tx?: unknown): Promise<Paginated<PricingRule>>;
}
