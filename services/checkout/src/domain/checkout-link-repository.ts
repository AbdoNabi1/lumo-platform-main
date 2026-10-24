import type { CheckoutLink } from "./checkout-link";

/**
 * Persistence port for {@link CheckoutLink} (order operations Part 3). ADR-0014: `tenantId` per call;
 * a token hash from another shop is simply unknown. Writes need the unit of work's `tx`.
 */
export interface CheckoutLinkRepository {
  /** Inserts a link issued in this request (`link.isNew`), otherwise updates its claim and revocation. */
  save(link: CheckoutLink, tenantId: string, tx?: unknown): Promise<void>;
  findByTokenHash(tokenHash: string, tenantId: string, tx?: unknown): Promise<CheckoutLink | null>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<CheckoutLink | null>;
  /** Every link of these checkouts, newest first. */
  listForSessions(
    checkoutSessionIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CheckoutLink[]>;
}
