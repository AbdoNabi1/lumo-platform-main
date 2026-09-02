import { describe, expect, it } from "vitest";
import { ThreatIntelAggregator } from "@platform/security";
import type { ThreatIntelProvider, ThreatVerdict } from "@platform/security";
import type { Logger } from "@platform/utils";
import { JsonHttpClient, type HttpFetch, type HttpResponse } from "./http-transport";
import { StaticBearerTokenProvider } from "./oauth-token";
import {
  AbuseIpDbProvider,
  AlienVaultOtxProvider,
  classifyIndicator,
  CloudflareProvider,
  CrowdStrikeProvider,
  MicrosoftDefenderProvider,
  VirusTotalProvider,
} from "./threat-providers";
import { buildResilientResolver, ResilientThreatProvider } from "./threat-resilience";

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

function httpReturning(body: unknown): JsonHttpClient {
  const fetchFn: HttpFetch = async () => {
    const response: HttpResponse = {
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
    return response;
  };
  return new JsonHttpClient({ fetch: fetchFn });
}

describe("classifyIndicator", () => {
  it("distinguishes ipv4 / hash / url / domain", () => {
    expect(classifyIndicator("8.8.8.8")).toBe("ipv4");
    expect(classifyIndicator("44d88612fea8a8f36de82e1278abb02f")).toBe("hash");
    expect(classifyIndicator("https://evil.test/x")).toBe("url");
    expect(classifyIndicator("evil.test")).toBe("domain");
  });
});

describe("threat provider response mapping", () => {
  it("AbuseIPDB maps confidence score above the threshold to malicious", async () => {
    const p = new AbuseIpDbProvider(
      httpReturning({ data: { abuseConfidenceScore: 75, usageType: "hosting" } }),
      "key",
    );
    const v = await p.lookup("8.8.8.8");
    expect(v).toMatchObject({ malicious: true, score: 75, source: "abuseipdb" });
    expect(v.categories).toContain("hosting");
  });

  it("VirusTotal maps detection stats to a ratio score", async () => {
    const p = new VirusTotalProvider(
      httpReturning({
        data: {
          attributes: {
            last_analysis_stats: { malicious: 3, suspicious: 0, harmless: 60, undetected: 7 },
          },
        },
      }),
      "key",
    );
    const v = await p.lookup("evil.test");
    expect(v.malicious).toBe(true);
    expect(v.score).toBeGreaterThan(0);
  });

  it("AlienVault OTX flags indicators present in pulses", async () => {
    const p = new AlienVaultOtxProvider(
      httpReturning({ pulse_info: { count: 2, pulses: [{ tags: ["botnet"] }] } }),
      "key",
    );
    const v = await p.lookup("1.2.3.4");
    expect(v.malicious).toBe(true);
    expect(v.categories).toContain("botnet");
  });

  it("Cloudflare flags indicators carrying risk types", async () => {
    const p = new CloudflareProvider(
      httpReturning({ result: [{ risk_types: [{ name: "phishing" }] }] }),
      "acct",
      "token",
    );
    const v = await p.lookup("1.2.3.4");
    expect(v).toMatchObject({ malicious: true, source: "cloudflare" });
    expect(v.categories).toContain("phishing");
  });

  it("CrowdStrike maps malicious_confidence to a score", async () => {
    const p = new CrowdStrikeProvider(
      httpReturning({
        resources: [{ malicious_confidence: "high", malware_families: ["emotet"] }],
      }),
      new StaticBearerTokenProvider("t"),
    );
    const v = await p.lookup("1.2.3.4");
    expect(v).toMatchObject({ malicious: true, score: 90 });
    expect(v.categories).toContain("emotet");
  });

  it("Microsoft Defender maps a malicious classification", async () => {
    const p = new MicrosoftDefenderProvider(
      httpReturning({ classification: "malicious", reputationScore: 88 }),
      new StaticBearerTokenProvider("t"),
      "https://defender.test/api",
    );
    const v = await p.lookup("1.2.3.4");
    expect(v).toMatchObject({ malicious: true, score: 88, source: "microsoft-defender" });
  });
});

// A controllable provider for resilience tests.
class FakeProvider implements ThreatIntelProvider {
  calls = 0;
  constructor(
    readonly name: string,
    private readonly behaviour: () => Promise<ThreatVerdict>,
  ) {}
  lookup(): Promise<ThreatVerdict> {
    this.calls += 1;
    return this.behaviour();
  }
}
const malicious = (name: string): ThreatVerdict => ({
  indicator: "1.2.3.4",
  malicious: true,
  score: 90,
  categories: ["c2"],
  source: name,
});

describe("ResilientThreatProvider", () => {
  it("degrades to a neutral verdict when the delegate throws (failover)", async () => {
    const p = new ResilientThreatProvider(
      new FakeProvider("bad", () => Promise.reject(new Error("down"))),
      { logger: silent },
    );
    const v = await p.lookup("1.2.3.4");
    expect(v).toMatchObject({
      malicious: false,
      score: 0,
      categories: ["provider-unavailable"],
      source: "bad",
    });
  });

  it("caches successful verdicts (no repeat upstream call)", async () => {
    const delegate = new FakeProvider("ok", () => Promise.resolve(malicious("ok")));
    const p = new ResilientThreatProvider(delegate, { logger: silent });
    await p.lookup("1.2.3.4");
    await p.lookup("1.2.3.4");
    expect(delegate.calls).toBe(1);
  });

  it("degrades to neutral on timeout", async () => {
    const delegate = new FakeProvider("slow", () => new Promise(() => undefined));
    const p = new ResilientThreatProvider(delegate, { logger: silent, timeoutMs: 10 });
    const v = await p.lookup("1.2.3.4");
    expect(v.categories).toContain("provider-unavailable");
  });

  it("opens the breaker after repeated failures and stops calling the delegate", async () => {
    const clock = 0;
    const delegate = new FakeProvider("flappy", () => Promise.reject(new Error("down")));
    const p = new ResilientThreatProvider(delegate, {
      logger: silent,
      failureThreshold: 2,
      cooldownMs: 10_000,
      now: () => clock,
    });
    await p.lookup("a");
    await p.lookup("b");
    const callsBefore = delegate.calls;
    await p.lookup("c"); // breaker open — short-circuits, delegate not called
    expect(delegate.calls).toBe(callsBefore);
  });
});

describe("buildResilientResolver + ThreatIntelAggregator", () => {
  it("fans out across feeds and aggregates a malicious verdict from any", async () => {
    const good = new FakeProvider("clean", () =>
      Promise.resolve({
        indicator: "1.2.3.4",
        malicious: false,
        score: 0,
        categories: [],
        source: "clean",
      }),
    );
    const bad = new FakeProvider("feed", () => Promise.resolve(malicious("feed")));
    const resolver = buildResilientResolver([good, bad], { logger: silent });
    const verdicts = await resolver.lookupAll("1.2.3.4");
    const aggregated = new ThreatIntelAggregator().aggregate("1.2.3.4", verdicts);
    expect(aggregated.malicious).toBe(true);
    expect(aggregated.score).toBe(90);
    expect(resolver.providerNames()).toEqual(["clean", "feed"]);
  });
});
