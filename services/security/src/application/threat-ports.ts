import type { ThreatVerdict } from "../domain/threat-intel";

/**
 * A **threat-intelligence provider plugin** (sprint P2.0-E §10) — one feed. Concrete adapters
 * (Cloudflare / CrowdStrike / SentinelOne / Microsoft Defender / VirusTotal / AbuseIPDB) implement
 * this; Security is never coupled to any of them.
 */
export interface ThreatIntelProvider {
  readonly name: string;
  lookup(indicator: string): Promise<ThreatVerdict>;
}

/** Resolves + queries every registered threat-intel provider for an indicator. */
export interface ThreatIntelResolver {
  providerNames(): readonly string[];
  lookupAll(indicator: string): Promise<readonly ThreatVerdict[]>;
}
