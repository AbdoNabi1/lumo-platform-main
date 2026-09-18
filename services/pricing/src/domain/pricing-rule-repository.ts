import type { CursorPage, Paginated } from "@platform/types";
import type { PricingRule } from "./pricing-rule";

/** Persistence port for {@link PricingRule}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface PricingRuleRepository {
  save(rule: PricingRule, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<PricingRule | null>;
  /** Cursor-paginated listing (Sprint 7.0). No `delete` — superseded by `active`/`deactivate()`. */
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<PricingRule>>;
}
