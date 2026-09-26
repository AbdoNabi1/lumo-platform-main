import type { TenantAvailability, TenantGate } from "@platform/http";

export interface CachedTenantGateDeps {
  /** Reads a tenant's status from the source of truth. Throws when it cannot be read. */
  readonly load: (tenantId: string) => Promise<TenantAvailability>;
  /**
   * The platform tenant (WP-14; ADR-0014 8f): owns Morbeh's plans, subscriptions and invoices, so it is
   * ALWAYS available and its status is never read. An empty id exempts nothing (fail closed).
   */
  readonly platformTenantId: string;
  /** Upper bound on how long a status change can go unseen by THIS instance. */
  readonly ttlMs: number;
  readonly now?: () => number;
}

interface Entry {
  readonly value: TenantAvailability;
  readonly expiresAt: number;
}

/**
 * T10.6 (Gap 1): the {@link TenantGate} the admin API mounts under `TENANT_MODE=multi`.
 *
 * **Cost.** A status is held in process for `ttlMs`, so the hot path is a Map lookup, not a database
 * read; concurrent first requests for one tenant share a single read (single-flight).
 *
 * **Staleness, stated rather than guessed.** A suspension or cancellation takes effect on the instance
 * that performs it immediately (`invalidate`, called from the lifecycle routes) and on every other
 * instance within `ttlMs`. There is no cross-instance push: the API process has no event consumer, and
 * inventing one to shave seconds off a billing action is not worth a second moving part.
 *
 * **Fail closed.** A failed read is never cached and never answered from an expired entry — it throws,
 * and the transport turns that into a 503. `unknown` (no row) is a cached answer, like any other.
 */
export class CachedTenantGate implements TenantGate {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<TenantAvailability>>();
  private readonly now: () => number;

  constructor(private readonly deps: CachedTenantGateDeps) {
    this.now = deps.now ?? Date.now;
  }

  async availability(tenantId: string): Promise<TenantAvailability> {
    if (this.deps.platformTenantId !== "" && tenantId === this.deps.platformTenantId) {
      return "active";
    }
    const hit = this.entries.get(tenantId);
    if (hit !== undefined && hit.expiresAt > this.now()) return hit.value;

    const pending = this.inflight.get(tenantId);
    if (pending !== undefined) return pending;

    const read = this.deps
      .load(tenantId)
      .then((value) => {
        // Only the read still in flight may populate the cache: `invalidate` mid-read drops it, so a
        // status read before the change cannot be cached after it.
        if (this.inflight.get(tenantId) === read) {
          this.entries.set(tenantId, { value, expiresAt: this.now() + this.deps.ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(tenantId) === read) this.inflight.delete(tenantId);
      });
    this.inflight.set(tenantId, read);
    return read;
  }

  /** Drops a tenant's cached status so its next request re-reads it. */
  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
    this.inflight.delete(tenantId);
  }
}
