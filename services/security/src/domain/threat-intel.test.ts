import { describe, expect, it } from "vitest";
import { ThreatIntelAggregator, type ThreatVerdict } from "./threat-intel";

const v = (
  source: string,
  malicious: boolean,
  score: number,
  categories: string[] = [],
): ThreatVerdict => ({ indicator: "1.2.3.4", malicious, score, categories, source });

describe("ThreatIntelAggregator (§10)", () => {
  const aggregator = new ThreatIntelAggregator();

  it("returns a clean verdict with no providers", () => {
    const result = aggregator.aggregate("1.2.3.4", []);
    expect(result.malicious).toBe(false);
    expect(result.score).toBe(0);
    expect(result.source).toBe("none");
  });

  it("flags malicious if any provider does and takes the max score + union of categories", () => {
    const result = aggregator.aggregate("1.2.3.4", [
      v("abuseipdb", false, 20, ["scanner"]),
      v("crowdstrike", true, 85, ["c2", "malware"]),
    ]);
    expect(result.malicious).toBe(true);
    expect(result.score).toBe(85);
    expect([...result.categories].sort()).toEqual(["c2", "malware", "scanner"]);
    expect(result.source).toBe("abuseipdb+crowdstrike");
  });
});
