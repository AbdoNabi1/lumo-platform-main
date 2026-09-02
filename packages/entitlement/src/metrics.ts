import type { EntitlementDecision } from "./entitlement-guard";

/** A read-only snapshot of entitlement decision metrics (P1.2.1 §4). Ratios are in [0,1]; latency in ms. */
export interface EntitlementMetricsSnapshot {
  readonly totalEvaluations: number;
  readonly allows: number;
  readonly denies: number;
  readonly allowRatio: number;
  readonly denyRatio: number;
  readonly averageLatencyMs: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheHitRatio: number;
  readonly cacheMissRatio: number;
  readonly quotaDenials: number;
  readonly policyDenials: number;
  readonly dependencyDenials: number;
  readonly merchantOverrideUsage: number;
  readonly platformOverrideUsage: number;
}

/**
 * Deterministic, in-process metrics accumulator (P1.2.1 §4). Read-only to consumers — the guard `record`s each
 * evaluation, the Platform Console `snapshot`s. Holds no business data. Idempotent per call (pure counters); a
 * fresh accumulator with the same event sequence yields the same snapshot.
 */
export class EntitlementMetrics {
  private total = 0;
  private allows = 0;
  private denies = 0;
  private latencySumMs = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private quotaDenials = 0;
  private policyDenials = 0;
  private dependencyDenials = 0;
  private merchantOverrideUsage = 0;
  private platformOverrideUsage = 0;

  record(
    decision: EntitlementDecision,
    meta: { readonly cacheHit: boolean; readonly latencyMs: number },
  ): void {
    this.total += 1;
    this.latencySumMs += meta.latencyMs;
    if (meta.cacheHit) this.cacheHits += 1;
    else this.cacheMisses += 1;
    if (decision.allowed) this.allows += 1;
    else this.denies += 1;
    if (decision.source === "quota_exceeded") this.quotaDenials += 1;
    if (decision.source === "policy_denied") this.policyDenials += 1;
    if (
      decision.source === "feature_unavailable" ||
      decision.explain?.missingDependency !== undefined
    )
      this.dependencyDenials += 1;
    if (decision.explain?.merchantOverride !== undefined || decision.source === "merchant_override")
      this.merchantOverrideUsage += 1;
    if (
      decision.explain?.platformOverride !== undefined ||
      decision.source === "platform_override" ||
      decision.source === "platform_emergency_override"
    )
      this.platformOverrideUsage += 1;
  }

  snapshot(): EntitlementMetricsSnapshot {
    const total = this.total;
    const safe = (n: number): number => (total === 0 ? 0 : n / total);
    const cacheTotal = this.cacheHits + this.cacheMisses;
    const cacheRatio = (n: number): number => (cacheTotal === 0 ? 0 : n / cacheTotal);
    return {
      totalEvaluations: total,
      allows: this.allows,
      denies: this.denies,
      allowRatio: safe(this.allows),
      denyRatio: safe(this.denies),
      averageLatencyMs: total === 0 ? 0 : this.latencySumMs / total,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRatio: cacheRatio(this.cacheHits),
      cacheMissRatio: cacheRatio(this.cacheMisses),
      quotaDenials: this.quotaDenials,
      policyDenials: this.policyDenials,
      dependencyDenials: this.dependencyDenials,
      merchantOverrideUsage: this.merchantOverrideUsage,
      platformOverrideUsage: this.platformOverrideUsage,
    };
  }

  reset(): void {
    this.total = this.allows = this.denies = this.latencySumMs = 0;
    this.cacheHits = this.cacheMisses = 0;
    this.quotaDenials = this.policyDenials = this.dependencyDenials = 0;
    this.merchantOverrideUsage = this.platformOverrideUsage = 0;
  }
}
