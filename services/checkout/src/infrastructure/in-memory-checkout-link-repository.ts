import { CheckoutLink, type CheckoutLinkSnapshot } from "../domain/checkout-link";
import type { CheckoutLinkRepository } from "../domain/checkout-link-repository";

export function newestFirst(links: readonly CheckoutLink[]): CheckoutLink[] {
  return [...links].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
  );
}

/**
 * In-memory `CheckoutLinkRepository` keyed by `(tenantId, id)` (ADR-0014). Stores snapshots, like
 * rows: a loaded link is a copy, and `save` of a loaded link writes only its revocation — the claim
 * fields are written by `recordClaim` alone, exactly as the Prisma adapter does.
 */
export class InMemoryCheckoutLinkRepository implements CheckoutLinkRepository {
  private readonly store = new Map<string, Map<string, CheckoutLinkSnapshot>>();

  async save(link: CheckoutLink, tenantId: string): Promise<void> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    if (link.isNew) {
      bucket.set(link.id, link.snapshot());
      return;
    }
    // Only the first revocation, like the Prisma adapter's guarded update.
    const stored = bucket.get(link.id);
    if (stored !== undefined && stored.revokedAt === null && link.revokedAt !== null) {
      bucket.set(link.id, { ...stored, revokedAt: link.revokedAt });
    }
  }

  /** Check and count in one synchronous step: no await between them, so no claim is lost. */
  async recordClaim(
    id: string,
    tenantId: string,
    now: Date,
    resultCheckoutRef: string,
  ): Promise<number | null> {
    const bucket = this.store.get(tenantId);
    const stored = bucket?.get(id);
    if (bucket === undefined || stored === undefined) return null;
    const link = CheckoutLink.reconstitute(stored);
    if (!link.isUsable(now)) return null;
    link.recordClaim(now, resultCheckoutRef);
    bucket.set(id, link.snapshot());
    return link.claimCount;
  }

  async findByTokenHash(tokenHash: string, tenantId: string): Promise<CheckoutLink | null> {
    for (const stored of this.store.get(tenantId)?.values() ?? []) {
      if (stored.tokenHash === tokenHash) return CheckoutLink.reconstitute(stored);
    }
    return null;
  }

  async findById(id: string, tenantId: string): Promise<CheckoutLink | null> {
    const stored = this.store.get(tenantId)?.get(id);
    return stored === undefined ? null : CheckoutLink.reconstitute(stored);
  }

  async listForSessions(
    checkoutSessionIds: readonly string[],
    tenantId: string,
  ): Promise<readonly CheckoutLink[]> {
    const wanted = new Set(checkoutSessionIds);
    const links = [...(this.store.get(tenantId)?.values() ?? [])]
      .filter((stored) => stored.checkoutSessionId !== null && wanted.has(stored.checkoutSessionId))
      .map((stored) => CheckoutLink.reconstitute(stored));
    return newestFirst(links);
  }

  async revokeForDraft(draftOrderRef: string, tenantId: string, now: Date): Promise<number> {
    const bucket = this.store.get(tenantId);
    if (bucket === undefined) return 0;
    let revoked = 0;
    for (const [id, stored] of bucket) {
      if (
        stored.purpose === "invoice" &&
        stored.draftOrderRef === draftOrderRef &&
        stored.revokedAt === null
      ) {
        bucket.set(id, { ...stored, revokedAt: now });
        revoked += 1;
      }
    }
    return revoked;
  }

  async listForDraft(draftOrderRef: string, tenantId: string): Promise<readonly CheckoutLink[]> {
    return newestFirst(
      [...(this.store.get(tenantId)?.values() ?? [])]
        .filter((stored) => stored.purpose === "invoice" && stored.draftOrderRef === draftOrderRef)
        .map((stored) => CheckoutLink.reconstitute(stored)),
    );
  }
}
