import type { Cache, Clock } from "@platform/contracts";
import type { EntitlementDecision } from "./entitlement-guard";
import type { EnforcementAction } from "./policy";

/**
 * Deterministic entitlement cache (P1.2 §8). A pure memoization layer over decisions — it never changes a verdict,
 * only avoids recomputing one. Keys are tenant-prefixed (ADR-0008 §2). Invalidation is **delete-then-miss**
 * (D-044): a miss goes to the source of truth, so a stale entry can never outlive an explicit invalidation.
 *
 * Replay-safe: caching is side-effect-free with respect to the domain; re-running a guarded action with a cold or
 * warm cache yields the same decision. An optional distributed {@link Cache} port (Redis) backs L2; L1 is an
 * in-process map for the <5ms budget.
 */
export interface EntitlementCacheOptions {
  /** Optional distributed cache (L2). Absent ⇒ in-process only. */
  readonly cache?: Cache;
  /** Entry lifetime; 0 disables expiry (explicit invalidation only). Default 30s. */
  readonly ttlSeconds?: number;
  readonly clock?: Clock;
}

interface Entry {
  readonly decision: EntitlementDecision;
  readonly expiresAtMs: number;
}

export class EntitlementCache {
  private readonly l1 = new Map<string, Entry>();
  /** tenant → keys, feature → keys: the indexes that make targeted invalidation exact. */
  private readonly byTenant = new Map<string, Set<string>>();
  private readonly byFeature = new Map<string, Set<string>>();
  private readonly l2?: Cache;
  private readonly ttlSeconds: number;
  private readonly now: () => number;

  constructor(options: EntitlementCacheOptions = {}) {
    if (options.cache !== undefined) this.l2 = options.cache;
    this.ttlSeconds = options.ttlSeconds ?? 30;
    const clock = options.clock;
    this.now = clock !== undefined ? (): number => clock.now().getTime() : (): number => Date.now();
  }

  /** Canonical, tenant-prefixed cache key. Deterministic for a given (tenant, feature, action). */
  key(tenant: string, featureKey: string, action: EnforcementAction): string {
    return `entitlement:${tenant}:${featureKey}:${action}`;
  }

  async get(
    tenant: string,
    featureKey: string,
    action: EnforcementAction,
  ): Promise<EntitlementDecision | null> {
    const k = this.key(tenant, featureKey, action);
    const hit = this.l1.get(k);
    if (hit !== undefined) {
      if (hit.expiresAtMs === 0 || hit.expiresAtMs > this.now()) return hit.decision;
      this.forget(k, tenant, featureKey);
    }
    if (this.l2 === undefined) return null;
    const remote = await this.l2.get<EntitlementDecision>(k);
    if (remote === null) return null;
    this.remember(k, tenant, featureKey, remote);
    return remote;
  }

  async set(
    tenant: string,
    featureKey: string,
    action: EnforcementAction,
    decision: EntitlementDecision,
  ): Promise<void> {
    const k = this.key(tenant, featureKey, action);
    this.remember(k, tenant, featureKey, decision);
    if (this.l2 !== undefined)
      await this.l2.set(k, decision, this.ttlSeconds > 0 ? this.ttlSeconds : undefined);
  }

  /** Invalidate everything for a tenant (subscription/plan/capability change). */
  async invalidateTenant(tenant: string): Promise<void> {
    for (const k of this.byTenant.get(tenant) ?? []) await this.drop(k);
    this.byTenant.delete(tenant);
  }

  /** Invalidate everything for a feature across tenants (feature definition/flag change). */
  async invalidateFeature(featureKey: string): Promise<void> {
    for (const k of this.byFeature.get(featureKey) ?? []) await this.drop(k);
    this.byFeature.delete(featureKey);
  }

  async invalidate(tenant: string, featureKey: string): Promise<void> {
    for (const action of ["read", "write"] as const)
      await this.drop(this.key(tenant, featureKey, action));
  }

  async clear(): Promise<void> {
    for (const k of [...this.l1.keys()]) await this.drop(k);
    this.l1.clear();
    this.byTenant.clear();
    this.byFeature.clear();
  }

  get size(): number {
    return this.l1.size;
  }

  private remember(
    k: string,
    tenant: string,
    featureKey: string,
    decision: EntitlementDecision,
  ): void {
    this.l1.set(k, {
      decision,
      expiresAtMs: this.ttlSeconds > 0 ? this.now() + this.ttlSeconds * 1000 : 0,
    });
    let tenantKeys = this.byTenant.get(tenant);
    if (tenantKeys === undefined) {
      tenantKeys = new Set<string>();
      this.byTenant.set(tenant, tenantKeys);
    }
    tenantKeys.add(k);
    let featureKeys = this.byFeature.get(featureKey);
    if (featureKeys === undefined) {
      featureKeys = new Set<string>();
      this.byFeature.set(featureKey, featureKeys);
    }
    featureKeys.add(k);
  }

  private forget(k: string, tenant: string, featureKey: string): void {
    this.l1.delete(k);
    this.byTenant.get(tenant)?.delete(k);
    this.byFeature.get(featureKey)?.delete(k);
  }

  private async drop(k: string): Promise<void> {
    this.l1.delete(k);
    if (this.l2 !== undefined) await this.l2.delete(k);
  }
}
