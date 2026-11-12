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

  save(link: CheckoutLink, tenantId: string): Promise<void> {
    try {
      let bucket = this.store.get(tenantId);
      if (bucket === undefined) {
        bucket = new Map();
        this.store.set(tenantId, bucket);
      }
      if (link.isNew) {
        bucket.set(link.id, link.snapshot());
        return Promise.resolve();
      }
      // Only the first revocation, like the Prisma adapter's guarded update.
      const stored = bucket.get(link.id);
      if (stored !== undefined && stored.revokedAt === null && link.revokedAt !== null) {
        bucket.set(link.id, { ...stored, revokedAt: link.revokedAt });
      }
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Check and count in one synchronous step: no await between them, so no claim is lost. */
  recordClaim(
    id: string,
    tenantId: string,
    now: Date,
    resultCheckoutRef: string,
  ): Promise<number | null> {
    try {
      const bucket = this.store.get(tenantId);
      const stored = bucket?.get(id);
      if (bucket === undefined || stored === undefined) return Promise.resolve(null);
      const link = CheckoutLink.reconstitute(stored);
      if (!link.isUsable(now)) return Promise.resolve(null);
      link.recordClaim(now, resultCheckoutRef);
      bucket.set(id, link.snapshot());
      return Promise.resolve(link.claimCount);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  findByTokenHash(tokenHash: string, tenantId: string): Promise<CheckoutLink | null> {
    try {
      for (const stored of this.store.get(tenantId)?.values() ?? []) {
        if (stored.tokenHash === tokenHash) {
          return Promise.resolve(CheckoutLink.reconstitute(stored));
        }
      }
      return Promise.resolve(null);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  findById(id: string, tenantId: string): Promise<CheckoutLink | null> {
    try {
      const stored = this.store.get(tenantId)?.get(id);
      return Promise.resolve(stored === undefined ? null : CheckoutLink.reconstitute(stored));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  listForSessions(
    checkoutSessionIds: readonly string[],
    tenantId: string,
  ): Promise<readonly CheckoutLink[]> {
    try {
      const wanted = new Set(checkoutSessionIds);
      const links = [...(this.store.get(tenantId)?.values() ?? [])]
        .filter(
          (stored) => stored.checkoutSessionId !== null && wanted.has(stored.checkoutSessionId),
        )
        .map((stored) => CheckoutLink.reconstitute(stored));
      return Promise.resolve(newestFirst(links));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Not `async` (nothing to await), in the lint-clean `Promise.resolve` form of
  // `in-memory-payment-adapters.ts`.
  revokeForDraft(draftOrderRef: string, tenantId: string, now: Date): Promise<number> {
    const bucket = this.store.get(tenantId);
    if (bucket === undefined) return Promise.resolve(0);
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
    return Promise.resolve(revoked);
  }

  listForDraft(draftOrderRef: string, tenantId: string): Promise<readonly CheckoutLink[]> {
    return Promise.resolve(
      newestFirst(
        [...(this.store.get(tenantId)?.values() ?? [])]
          .filter(
            (stored) => stored.purpose === "invoice" && stored.draftOrderRef === draftOrderRef,
          )
          .map((stored) => CheckoutLink.reconstitute(stored)),
      ),
    );
  }
}
