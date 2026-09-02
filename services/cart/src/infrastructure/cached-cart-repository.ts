import type { Cache } from "@platform/contracts";
import type { CursorPage, Paginated } from "@platform/types";
import type { Cart } from "../domain/cart";
import type { CartListFilter, CartRepository } from "../domain/cart-repository";
import { CartMapper, type CartItemRow, type CartRow } from "./cart.mapper";

/** The cached shape: mapper ROW DTOs, never the live aggregate (Cache port contract, D-044). */
interface CachedCart {
  readonly cart: CartRow;
  readonly items: readonly CartItemRow[];
}

export interface CachedCartRepositoryDeps {
  /** The durable source of truth (Prisma in production, in-memory in tests) — D-042/doc 26. */
  readonly inner: CartRepository;
  readonly cache: Cache;
  /** Tenant scope — cache keys are tenant-prefixed (ADR-0008 §2). */
  readonly tenantId: string;
  /** Hot-cart TTL; short by design (live carts churn). Default 900s. */
  readonly ttlSeconds?: number;
}

/**
 * Read-through / delete-on-write hot layer over the durable `CartRepository` (Sprint 2.3;
 * doc 26 §1 — Redis fronts Postgres, never replaces it, so the transactional-outbox invariant
 * is untouched).
 *
 * Correctness rules:
 * - **Transactional reads bypass the cache** (`findById(id, tx)`): inside a unit of work the
 *   caller needs read-your-writes from the source of truth.
 * - **Writes delete, never update, the cache entry** — `save` runs inside the caller's
 *   transaction, which may still roll back; a deleted key costs one miss, a written key could
 *   lie forever. Repopulation happens on the next untransacted read.
 * - Cached values are mapper row DTOs; reads rehydrate via `CartMapper.toDomain`, so every
 *   domain invariant is re-established and a corrupt cache entry fails loudly instead of
 *   producing a broken aggregate.
 * - Cache failures on the read path degrade to the source of truth (availability over speed);
 *   the delete-on-write MUST propagate failure — an uninvalidated stale entry is a correctness
 *   bug, not a degradation.
 */
export class CachedCartRepository implements CartRepository {
  private readonly deps: Required<CachedCartRepositoryDeps>;

  constructor(deps: CachedCartRepositoryDeps) {
    this.deps = { ttlSeconds: 900, ...deps };
  }

  async save(cart: Cart, tx?: unknown): Promise<void> {
    await this.deps.inner.save(cart, tx);
    // Inside the caller's tx: delete (safe under rollback), never write.
    await this.deps.cache.delete(this.key(cart.id.toString()));
  }

  async findById(id: string, tx?: unknown): Promise<Cart | null> {
    if (tx !== undefined && tx !== null) {
      return this.deps.inner.findById(id, tx); // read-your-writes inside a transaction
    }

    let cached: CachedCart | null = null;
    try {
      cached = await this.deps.cache.get<CachedCart>(this.key(id));
    } catch {
      cached = null; // cache outage degrades to the source of truth
    }
    if (cached !== null) {
      return CartMapper.toDomain(cached.cart, cached.items);
    }

    const cart = await this.deps.inner.findById(id);
    if (cart !== null) {
      const snapshot: CachedCart = {
        cart: CartMapper.toCartRow(cart, this.deps.tenantId),
        items: CartMapper.toItemRows(cart, this.deps.tenantId),
      };
      // Preserve the true persisted version — toCartRow stamps the first-write version.
      const withVersion: CachedCart = {
        cart: { ...snapshot.cart, version: cart.version },
        items: snapshot.items,
      };
      try {
        await this.deps.cache.set(this.key(id), withVersion, this.deps.ttlSeconds);
      } catch {
        // population failure is harmless — next read tries again
      }
    }
    return cart;
  }

  /**
   * Deliberately uncached (Phase 17.1) — session lookups are keyed by `sessionRef`, not `cartId`,
   * so caching them would need a second cache-key strategy for one call site (the guest
   * current-cart read) that isn't the hot path `findById` already optimizes for a live checkout.
   * Not a speculative addition to defer: a real cache here would need its own invalidation story
   * (e.g. on every mutation, not just `save`'s single-key delete), which is out of this phase's
   * scope.
   */
  async findBySessionRef(sessionRef: string, tx?: unknown): Promise<Cart | null> {
    return this.deps.inner.findBySessionRef(sessionRef, tx);
  }

  /**
   * Deliberately uncached, same rationale as `findBySessionRef` above: a status-filtered page scan
   * is not the hot single-cart lookup `findById` optimizes for, and would need its own
   * invalidation story (every status transition, not just `save`'s single-key delete).
   */
  async list(page: CursorPage, filter?: CartListFilter, tx?: unknown): Promise<Paginated<Cart>> {
    return this.deps.inner.list(page, filter, tx);
  }

  private key(cartId: string): string {
    return `tenant:${this.deps.tenantId}:cart:${cartId}`;
  }
}
