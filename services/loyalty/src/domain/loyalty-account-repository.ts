import type { CursorPage, Paginated } from "@platform/types";
import type { LoyaltyAccount } from "./loyalty-account";

/** Persistence port for {@link LoyaltyAccount}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface LoyaltyAccountRepository {
  save(account: LoyaltyAccount, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<LoyaltyAccount | null>;
  findByCustomerRef(customerRef: string, tx?: unknown): Promise<LoyaltyAccount | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<LoyaltyAccount>>;
}
