import { MultiThreatIntelResolver } from "@platform/security";
import type { ThreatIntelProvider, ThreatIntelResolver, ThreatVerdict } from "@platform/security";
import type { Logger } from "@platform/utils";
import { CircuitBreaker, TtlCache, withTimeout } from "./resilience";

/**
 * Wraps a threat-intel provider with **timeout protection, a circuit breaker, and a TTL cache** (H-3 /
 * G-SEC-2). A slow/failing feed is isolated: a timed-out or erroring lookup is logged (never silently
 * swallowed) and degrades to a **neutral** verdict (`malicious:false`, source tagged
 * `provider-unavailable`) so the fan-out across the other feeds still completes — threat enrichment fails
 * open and observable, not closed. Only successful verdicts are cached, so an outage never poisons the
 * cache; the breaker stops hammering a dead feed.
 */
export interface ResilientThreatOptions {
  /** Per-lookup timeout in ms (default 3000). */
  readonly timeoutMs?: number;
  /** Consecutive failures before the feed's breaker opens (default 5). */
  readonly failureThreshold?: number;
  /** Breaker cooldown in ms (default 30s). */
  readonly cooldownMs?: number;
  /** Cache TTL in ms (default 5 min). */
  readonly cacheTtlMs?: number;
  readonly logger: Logger;
  /** Injected clock for the breaker + cache (tests). */
  readonly now?: () => number;
}

export class ResilientThreatProvider implements ThreatIntelProvider {
  readonly name: string;
  private readonly delegate: ThreatIntelProvider;
  private readonly timeoutMs: number;
  private readonly breaker: CircuitBreaker;
  private readonly cache: TtlCache<ThreatVerdict>;
  private readonly logger: Logger;

  constructor(delegate: ThreatIntelProvider, options: ResilientThreatOptions) {
    this.delegate = delegate;
    this.name = delegate.name;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.logger = options.logger;
    this.breaker = new CircuitBreaker({
      name: `threat.${delegate.name}`,
      failureThreshold: options.failureThreshold ?? 5,
      cooldownMs: options.cooldownMs ?? 30_000,
      ...(options.now !== undefined ? { now: () => options.now?.() ?? Date.now() } : {}),
    });
    this.cache = new TtlCache<ThreatVerdict>(options.cacheTtlMs ?? 300_000, options.now);
  }

  async lookup(indicator: string): Promise<ThreatVerdict> {
    const cached = this.cache.get(indicator);
    if (cached !== undefined) return cached;
    try {
      const verdict = await this.breaker.exec(() =>
        withTimeout(() => this.delegate.lookup(indicator), this.timeoutMs, `${this.name}.lookup`),
      );
      this.cache.set(indicator, verdict);
      return verdict;
    } catch (error) {
      this.logger.warn("threat-intel provider unavailable — degrading to neutral verdict", {
        provider: this.name,
        indicator,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        indicator,
        malicious: false,
        score: 0,
        categories: ["provider-unavailable"],
        source: this.name,
      };
    }
  }
}

/**
 * Builds a fan-out {@link ThreatIntelResolver} over the given providers, each wrapped for resilience.
 * Reuses `MultiThreatIntelResolver` for the fan-out (no duplicate resolver) and, in turn, the existing
 * `ThreatIntelAggregator` combines the verdicts downstream — this only adds the per-feed hardening.
 */
export function buildResilientResolver(
  providers: readonly ThreatIntelProvider[],
  options: ResilientThreatOptions,
): ThreatIntelResolver {
  return new MultiThreatIntelResolver(
    providers.map((p) => new ResilientThreatProvider(p, options)),
  );
}
