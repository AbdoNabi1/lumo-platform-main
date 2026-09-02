import type { ThreatVerdict } from "../domain/threat-intel";
import type { ThreatIntelProvider, ThreatIntelResolver } from "../application/threat-ports";

/**
 * A reference in-memory {@link ThreatIntelProvider} (offline/tests) — a seedable indicator→verdict
 * map. Real feed adapters (Cloudflare/CrowdStrike/…) implement the same interface later (gap G-SEC-2).
 */
export class InMemoryThreatIntelProvider implements ThreatIntelProvider {
  private readonly table = new Map<
    string,
    { malicious: boolean; score: number; categories: readonly string[] }
  >();
  constructor(readonly name: string) {}
  seed(
    indicator: string,
    data: { malicious: boolean; score: number; categories?: readonly string[] },
  ): void {
    this.table.set(indicator, {
      malicious: data.malicious,
      score: data.score,
      categories: data.categories ?? [],
    });
  }
  async lookup(indicator: string): Promise<ThreatVerdict> {
    const hit = this.table.get(indicator);
    if (hit === undefined)
      return { indicator, malicious: false, score: 0, categories: [], source: this.name };
    return {
      indicator,
      malicious: hit.malicious,
      score: hit.score,
      categories: hit.categories,
      source: this.name,
    };
  }
}

/** Queries every registered provider and returns all verdicts (the aggregator combines them). */
export class MultiThreatIntelResolver implements ThreatIntelResolver {
  private readonly providers: ThreatIntelProvider[];
  constructor(providers: readonly ThreatIntelProvider[] = []) {
    this.providers = [...providers];
  }
  register(provider: ThreatIntelProvider): void {
    this.providers.push(provider);
  }
  providerNames(): readonly string[] {
    return this.providers.map((p) => p.name);
  }
  async lookupAll(indicator: string): Promise<readonly ThreatVerdict[]> {
    return Promise.all(this.providers.map((p) => p.lookup(indicator)));
  }
}
