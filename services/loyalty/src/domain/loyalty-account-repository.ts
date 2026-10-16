import type { CursorPage, Paginated } from "@platform/types";
import type { LoyaltyAccount } from "./loyalty-account";

/**
 * Persistence port for {@link LoyaltyAccount}. Implemented in infrastructure. The optional `tx`
 * scopes the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter,
 * matching `services/catalog`'s shape. `LoyaltyAccount` carries no `tenantId` of its own, so
 * `save` takes it as an explicit parameter (Option B) rather than reading it off the aggregate.
 */
export interface LoyaltyAccountRepository {
  save(account: LoyaltyAccount, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<LoyaltyAccount | null>;
  findByCustomerRef(
    customerRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<LoyaltyAccount | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<LoyaltyAccount>>;
}
