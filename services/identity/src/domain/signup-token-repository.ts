import type { SignupToken } from "./signup-token";

export interface SignupTokenRepository {
  save(token: SignupToken, tx?: unknown): Promise<void>;
  findByHash(tokenHash: string, tenantId: string, tx?: unknown): Promise<SignupToken | null>;
  /**
   * Marks every non-consumed, non-expired token for this customer as consumed as of `now` (D3:
   * issuing a new token invalidates earlier ones). Does not delete rows — a consumed row is kept
   * for audit, exactly like `identity.consent_records` never deletes.
   */
  invalidateAllForCustomer(
    customerId: string,
    tenantId: string,
    now: Date,
    tx?: unknown,
  ): Promise<void>;
  /**
   * Conditionally consumes the token with this id — succeeds only if it was still unconsumed at
   * the moment of the write. Returns `true` when THIS call won the race, `false` when it lost (the
   * token was already consumed, by a concurrent completion or otherwise). Callers must treat
   * `false` identically to "invalid token" (indistinguishable rejection reasons, per the brief).
   */
  markConsumed(id: string, tenantId: string, now: Date, tx?: unknown): Promise<boolean>;
}
