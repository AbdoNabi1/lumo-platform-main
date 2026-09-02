import type { ThreatIntelProvider } from "@platform/security";
import type { ThreatVerdict } from "@platform/security";
import type { JsonHttpClient } from "./http-transport";
import type { BearerTokenProvider } from "./kms-cloud";

/**
 * Production **threat-intelligence provider plugins** (H-3 / G-SEC-2) — real REST clients for AbuseIPDB,
 * VirusTotal, AlienVault OTX, Cloudflare Intel, CrowdStrike Falcon Intel, and Microsoft Defender TI. Each
 * implements the Security context's `ThreatIntelProvider` port and maps its native response onto the
 * provider-agnostic {@link ThreatVerdict} (malicious flag + 0–100 confidence + categories). Security is
 * never coupled to any of them; they are fanned-out + aggregated by the existing resolver/aggregator.
 * API keys/tokens authenticate requests and are never logged.
 */

export type IndicatorKind = "ipv4" | "hash" | "url" | "domain";

/** Classifies an indicator so type-specific feeds hit the right endpoint. */
export function classifyIndicator(indicator: string): IndicatorKind {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(indicator)) return "ipv4";
  if (/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(indicator)) return "hash";
  if (/^https?:\/\//i.test(indicator)) return "url";
  return "domain";
}

const clamp = (score: number): number => Math.max(0, Math.min(100, Math.round(score)));

/** Shared base — the verdict factory + injected HTTP client, so no feed re-implements clamping/shape. */
abstract class HttpThreatProvider implements ThreatIntelProvider {
  abstract readonly name: string;
  protected constructor(protected readonly http: JsonHttpClient) {}
  abstract lookup(indicator: string): Promise<ThreatVerdict>;
  protected verdict(
    indicator: string,
    malicious: boolean,
    score: number,
    categories: readonly string[],
  ): ThreatVerdict {
    return {
      indicator,
      malicious,
      score: clamp(score),
      categories: [...categories],
      source: this.name,
    };
  }
}

// ── AbuseIPDB ─────────────────────────────────────────────────────────────────────────────────────
interface AbuseIpDbResponse {
  readonly data?: {
    readonly abuseConfidenceScore?: number;
    readonly usageType?: string;
    readonly isTor?: boolean;
  };
}
export class AbuseIpDbProvider extends HttpThreatProvider {
  readonly name = "abuseipdb";
  constructor(
    http: JsonHttpClient,
    private readonly apiKey: string,
    private readonly maliciousThreshold = 50,
  ) {
    super(http);
  }
  async lookup(indicator: string): Promise<ThreatVerdict> {
    const res = (await this.http.getJson(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(indicator)}&maxAgeInDays=90`,
      {
        Key: this.apiKey,
        Accept: "application/json",
      },
    )) as AbuseIpDbResponse;
    const score = res.data?.abuseConfidenceScore ?? 0;
    const categories = [res.data?.usageType, res.data?.isTor === true ? "tor" : undefined].filter(
      (c): c is string => typeof c === "string",
    );
    return this.verdict(indicator, score >= this.maliciousThreshold, score, categories);
  }
}

// ── VirusTotal ────────────────────────────────────────────────────────────────────────────────────
interface VirusTotalResponse {
  readonly data?: {
    readonly attributes?: {
      readonly last_analysis_stats?: {
        readonly malicious?: number;
        readonly suspicious?: number;
        readonly harmless?: number;
        readonly undetected?: number;
      };
    };
  };
}
export class VirusTotalProvider extends HttpThreatProvider {
  readonly name = "virustotal";
  constructor(
    http: JsonHttpClient,
    private readonly apiKey: string,
  ) {
    super(http);
  }
  private path(indicator: string): string {
    switch (classifyIndicator(indicator)) {
      case "ipv4":
        return `ip_addresses/${indicator}`;
      case "hash":
        return `files/${indicator}`;
      case "url":
        return `urls/${Buffer.from(indicator, "utf8").toString("base64url").replace(/=+$/, "")}`;
      default:
        return `domains/${indicator}`;
    }
  }
  async lookup(indicator: string): Promise<ThreatVerdict> {
    const res = (await this.http.getJson(
      `https://www.virustotal.com/api/v3/${this.path(indicator)}`,
      { "x-apikey": this.apiKey },
    )) as VirusTotalResponse;
    const stats = res.data?.attributes?.last_analysis_stats ?? {};
    const malicious = stats.malicious ?? 0;
    const suspicious = stats.suspicious ?? 0;
    const total = malicious + suspicious + (stats.harmless ?? 0) + (stats.undetected ?? 0);
    const score = total === 0 ? 0 : ((malicious + suspicious) / total) * 100;
    const categories = [
      malicious > 0 ? "malicious" : undefined,
      suspicious > 0 ? "suspicious" : undefined,
    ].filter((c): c is string => typeof c === "string");
    return this.verdict(indicator, malicious > 0, score, categories);
  }
}

// ── AlienVault OTX ────────────────────────────────────────────────────────────────────────────────
interface OtxResponse {
  readonly pulse_info?: {
    readonly count?: number;
    readonly pulses?: readonly { readonly tags?: readonly string[] }[];
  };
}
export class AlienVaultOtxProvider extends HttpThreatProvider {
  readonly name = "alienvault-otx";
  constructor(
    http: JsonHttpClient,
    private readonly apiKey: string,
  ) {
    super(http);
  }
  private section(indicator: string): string {
    switch (classifyIndicator(indicator)) {
      case "ipv4":
        return "IPv4";
      case "hash":
        return "file";
      case "url":
        return "url";
      default:
        return "domain";
    }
  }
  async lookup(indicator: string): Promise<ThreatVerdict> {
    const res = (await this.http.getJson(
      `https://otx.alienvault.com/api/v1/indicators/${this.section(indicator)}/${encodeURIComponent(indicator)}/general`,
      {
        "X-OTX-API-KEY": this.apiKey,
      },
    )) as OtxResponse;
    const count = res.pulse_info?.count ?? 0;
    const categories = [...new Set((res.pulse_info?.pulses ?? []).flatMap((p) => p.tags ?? []))];
    return this.verdict(indicator, count > 0, count * 10, categories);
  }
}

// ── Cloudflare Intel ──────────────────────────────────────────────────────────────────────────────
interface CloudflareResponse {
  readonly result?: readonly { readonly risk_types?: readonly { readonly name?: string }[] }[];
}
export class CloudflareProvider extends HttpThreatProvider {
  readonly name = "cloudflare";
  constructor(
    http: JsonHttpClient,
    private readonly accountId: string,
    private readonly apiToken: string,
  ) {
    super(http);
  }
  async lookup(indicator: string): Promise<ThreatVerdict> {
    const res = (await this.http.getJson(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/intel/ip?ipv4=${encodeURIComponent(indicator)}`,
      {
        Authorization: `Bearer ${this.apiToken}`,
      },
    )) as CloudflareResponse;
    const riskTypes = (res.result ?? []).flatMap((r) =>
      (r.risk_types ?? []).map((t) => t.name).filter((n): n is string => typeof n === "string"),
    );
    return this.verdict(indicator, riskTypes.length > 0, riskTypes.length > 0 ? 80 : 0, riskTypes);
  }
}

// ── CrowdStrike Falcon Intel ──────────────────────────────────────────────────────────────────────
interface CrowdStrikeResponse {
  readonly resources?: readonly {
    readonly malicious_confidence?: string;
    readonly malware_families?: readonly string[];
  }[];
}
const CONFIDENCE_SCORE: Record<string, number> = { high: 90, medium: 60, low: 30, unverified: 10 };
export class CrowdStrikeProvider extends HttpThreatProvider {
  readonly name = "crowdstrike";
  constructor(
    http: JsonHttpClient,
    private readonly tokenProvider: BearerTokenProvider,
    private readonly apiBase = "https://api.crowdstrike.com",
  ) {
    super(http);
  }
  async lookup(indicator: string): Promise<ThreatVerdict> {
    const token = await this.tokenProvider.getToken();
    const res = (await this.http.getJson(
      `${this.apiBase}/intel/combined/indicators/v1?filter=${encodeURIComponent(`indicator:'${indicator}'`)}`,
      {
        Authorization: `Bearer ${token}`,
      },
    )) as CrowdStrikeResponse;
    const top = res.resources?.[0];
    const score =
      top?.malicious_confidence !== undefined
        ? (CONFIDENCE_SCORE[top.malicious_confidence] ?? 0)
        : 0;
    return this.verdict(indicator, score >= 60, score, top?.malware_families ?? []);
  }
}

// ── Microsoft Defender TI ─────────────────────────────────────────────────────────────────────────
interface DefenderResponse {
  readonly classification?: string;
  readonly reputationScore?: number;
  readonly categories?: readonly string[];
}
export class MicrosoftDefenderProvider extends HttpThreatProvider {
  readonly name = "microsoft-defender";
  constructor(
    http: JsonHttpClient,
    private readonly tokenProvider: BearerTokenProvider,
    private readonly apiBase: string,
  ) {
    super(http);
  }
  async lookup(indicator: string): Promise<ThreatVerdict> {
    const token = await this.tokenProvider.getToken();
    const res = (await this.http.getJson(
      `${this.apiBase}/reputation/${encodeURIComponent(indicator)}`,
      { Authorization: `Bearer ${token}` },
    )) as DefenderResponse;
    const malicious = (res.classification ?? "").toLowerCase() === "malicious";
    const score = res.reputationScore ?? (malicious ? 85 : 0);
    return this.verdict(indicator, malicious, score, res.categories ?? []);
  }
}
