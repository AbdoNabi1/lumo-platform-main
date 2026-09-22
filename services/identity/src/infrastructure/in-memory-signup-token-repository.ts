import { type SignupToken } from "../domain/signup-token";
import type { SignupTokenRepository } from "../domain/signup-token-repository";

/** In-memory `SignupTokenRepository` — keyed by token id; scans for `(tenantId, tokenHash)` lookups (acceptable for the in-memory adapter, mirrors `InMemoryCustomerRepository`). */
export class InMemorySignupTokenRepository implements SignupTokenRepository {
  private readonly store = new Map<string, SignupToken>();

  async save(token: SignupToken): Promise<void> {
    this.store.set(token.id.toString(), token);
  }

  async findByHash(tokenHash: string, tenantId: string): Promise<SignupToken | null> {
    for (const token of this.store.values()) {
      if (token.tenantId === tenantId && token.tokenHash === tokenHash) return token;
    }
    return null;
  }

  async invalidateAllForCustomer(customerId: string, tenantId: string, now: Date): Promise<void> {
    for (const token of this.store.values()) {
      if (token.tenantId === tenantId && token.customerId === customerId && token.isValid(now)) {
        token.consume(now);
      }
    }
  }

  async markConsumed(id: string, tenantId: string, now: Date): Promise<boolean> {
    const token = this.store.get(id);
    if (token === undefined || token.tenantId !== tenantId || !token.isValid(now)) return false;
    token.consume(now);
    return true;
  }
}
