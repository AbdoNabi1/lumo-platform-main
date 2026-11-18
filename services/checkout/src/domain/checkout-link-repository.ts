import type { CheckoutLink } from "./checkout-link";

/**
 * Persistence port for {@link CheckoutLink} (order operations Part 3). ADR-0014: `tenantId` per call;
 * a token hash from another shop is simply unknown. Writes need the unit of work's `tx`.
 */
export interface CheckoutLinkRepository {
  /**
   * Inserts a link issued in this request (`link.isNew`), otherwise sets its revocation, once: a
   * guarded update that writes ONLY `revokedAt` where it is still null — the claim fields
   * (`claimCount`, `lastClaimedAt`, `resultCheckoutRef`) are {@link recordClaim}'s alone.
   */
  save(link: CheckoutLink, tenantId: string, tx?: unknown): Promise<void>;
  /**
   * Counts one claim ATOMICALLY (`claim_count = claim_count + 1` in one guarded statement), so
   * concurrent claims never lose an increment: applies only while the link is usable at `now` (not
   * revoked, not expired), stamps `lastClaimedAt` and `resultCheckoutRef`, and answers the new claim
   * count — or null when the link is unknown in this shop or no longer usable. Needs the unit of
   * work's `tx`. Claims go through here, never through a load-modify-`save`.
   */
  recordClaim(
    id: string,
    tenantId: string,
    now: Date,
    resultCheckoutRef: string,
    tx?: unknown,
  ): Promise<number | null>;
  findByTokenHash(tokenHash: string, tenantId: string, tx?: unknown): Promise<CheckoutLink | null>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<CheckoutLink | null>;
  /** Every link of these checkouts, newest first. */
  listForSessions(
    checkoutSessionIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CheckoutLink[]>;
  /**
   * Part 4: revokes every still-live invoice link of a draft (deleted draft). ONE guarded
   * `updateMany` that writes only `revokedAt` where it is null — never a claim field (binding carry 1).
   * Answers how many it revoked. Needs the unit of work's `tx`.
   */
  revokeForDraft(draftOrderRef: string, tenantId: string, now: Date, tx?: unknown): Promise<number>;
  /** Part 4: a draft's invoice links, newest first. */
  listForDraft(
    draftOrderRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly CheckoutLink[]>;
}
