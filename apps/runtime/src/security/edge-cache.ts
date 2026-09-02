import { TtlCache } from "./resilience";

/**
 * The Security **edge cache** (H-4 / G-SEC-3) — a version-aware, TTL, invalidatable read cache for the
 * hot edge lookups the zero-trust request path repeats: policy fragments, registry lookups, threat-intel
 * verdicts, and machine-identity profiles. It **reuses** {@link TtlCache} (no second cache engine); it
 * only adds **version awareness** (a version token folded into every key, so a single bump invalidates a
 * whole namespace) and explicit **invalidation** (single key or whole namespace). It never caches secrets
 * or key material — only decisions/metadata that are safe to memoise for a short TTL.
 */
export type EdgeCacheNamespace =
  "policy-fragment" | "registry" | "threat-intel" | "machine-identity";

export interface EdgeCacheOptions {
  /** TTL per namespace in ms. Falls back to `defaultTtlMs` when a namespace is unset. */
  readonly ttlMsByNamespace?: Partial<Record<EdgeCacheNamespace, number>>;
  readonly defaultTtlMs?: number;
  /** Injected clock (tests). */
  readonly now?: () => number;
}

export class EdgeCache {
  private readonly caches = new Map<EdgeCacheNamespace, TtlCache<unknown>>();
  private readonly versions = new Map<EdgeCacheNamespace, number>();
  private readonly ttlByNamespace: Partial<Record<EdgeCacheNamespace, number>>;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private hits = 0;
  private misses = 0;

  constructor(options: EdgeCacheOptions = {}) {
    this.ttlByNamespace = options.ttlMsByNamespace ?? {};
    this.defaultTtlMs = options.defaultTtlMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  private cacheFor(namespace: EdgeCacheNamespace): TtlCache<unknown> {
    let cache = this.caches.get(namespace);
    if (cache === undefined) {
      cache = new TtlCache<unknown>(this.ttlByNamespace[namespace] ?? this.defaultTtlMs, this.now);
      this.caches.set(namespace, cache);
    }
    return cache;
  }

  private versionedKey(namespace: EdgeCacheNamespace, key: string): string {
    return `v${this.versions.get(namespace) ?? 0}:${key}`;
  }

  /** Reads a cached value (fresh + current version), or `undefined` on miss/expiry/stale-version. */
  get<V>(namespace: EdgeCacheNamespace, key: string): V | undefined {
    const value = this.cacheFor(namespace).get(this.versionedKey(namespace, key)) as V | undefined;
    if (value === undefined) this.misses += 1;
    else this.hits += 1;
    return value;
  }

  set<V>(namespace: EdgeCacheNamespace, key: string, value: V): void {
    this.cacheFor(namespace).set(this.versionedKey(namespace, key), value);
  }

  /**
   * Returns the cached value or computes + caches it (single-flight-free, TTL/version aware). The loader
   * only runs on a miss, so hot lookups stay off the upstream (policy store / registry / feed / profile).
   */
  async getOrLoad<V>(
    namespace: EdgeCacheNamespace,
    key: string,
    loader: () => Promise<V>,
  ): Promise<V> {
    const cached = this.get<V>(namespace, key);
    if (cached !== undefined) return cached;
    const value = await loader();
    this.set(namespace, key, value);
    return value;
  }

  /** Invalidates a single key in a namespace (targeted event-driven bust). */
  invalidate(namespace: EdgeCacheNamespace, key: string): void {
    this.cacheFor(namespace).delete(this.versionedKey(namespace, key));
  }

  /** Bumps a namespace's version — instantly invalidating every key under it (bulk / config-change bust). */
  bumpVersion(namespace: EdgeCacheNamespace): number {
    const next = (this.versions.get(namespace) ?? 0) + 1;
    this.versions.set(namespace, next);
    return next;
  }

  /** Cache hit/miss counters for the `policy_cache_hits` metric. */
  stats(): { readonly hits: number; readonly misses: number } {
    return { hits: this.hits, misses: this.misses };
  }
}
