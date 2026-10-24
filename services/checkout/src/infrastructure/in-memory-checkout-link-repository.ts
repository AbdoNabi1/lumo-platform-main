import type { CheckoutLink } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";

export function newestFirst(links: readonly CheckoutLink[]): CheckoutLink[] {
  return [...links].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
  );
}

/** In-memory `CheckoutLinkRepository` keyed by `(tenantId, id)` (ADR-0014). */
export class InMemoryCheckoutLinkRepository implements CheckoutLinkRepository {
  private readonly store = new Map<string, Map<string, CheckoutLink>>();

  async save(link: CheckoutLink, tenantId: string): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    bucket.set(link.id, link);
  }

  async findByTokenHash(tokenHash: string, tenantId: string): Promise<CheckoutLink | null> {
    for (const link of this.store.get(tenantId)?.values() ?? []) {
      if (link.tokenHash === tokenHash) return link;
    }
    return null;
  }

  async findById(id: string, tenantId: string): Promise<CheckoutLink | null> {
    return this.store.get(tenantId)?.get(id) ?? null;
  }

  async listForSessions(
    checkoutSessionIds: readonly string[],
    tenantId: string,
  ): Promise<readonly CheckoutLink[]> {
    const wanted = new Set(checkoutSessionIds);
    const links = [...(this.store.get(tenantId)?.values() ?? [])].filter(
      (link) => link.checkoutSessionId !== null && wanted.has(link.checkoutSessionId),
    );
    return newestFirst(links);
  }
}
