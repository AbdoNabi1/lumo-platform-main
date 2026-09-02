/**
 * A **threat-intelligence verdict** for an indicator (IP / domain / hash / URL) — sprint P2.0-E §10.
 * Provider-agnostic: each feed returns one, and the {@link ThreatIntelAggregator} combines them.
 */
export interface ThreatVerdict {
  readonly indicator: string;
  readonly malicious: boolean;
  /** Confidence/severity 0–100. */
  readonly score: number;
  readonly categories: readonly string[];
  /** The contributing source(s). */
  readonly source: string;
}

/**
 * Combines verdicts from multiple threat-intel providers into one — malicious if **any** provider
 * flags it, score = the max, categories = the union. Pure and deterministic. Providers
 * (Cloudflare / CrowdStrike / SentinelOne / Microsoft Defender / VirusTotal / AbuseIPDB) plug in
 * behind the resolver port without touching this logic.
 */
export class ThreatIntelAggregator {
  aggregate(indicator: string, verdicts: readonly ThreatVerdict[]): ThreatVerdict {
    if (verdicts.length === 0)
      return { indicator, malicious: false, score: 0, categories: [], source: "none" };
    return {
      indicator,
      malicious: verdicts.some((v) => v.malicious),
      score: Math.max(...verdicts.map((v) => v.score)),
      categories: [...new Set(verdicts.flatMap((v) => v.categories))],
      source: [...new Set(verdicts.map((v) => v.source))].join("+"),
    };
  }
}
