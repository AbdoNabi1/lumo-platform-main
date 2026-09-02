import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "./composition";
import type { CryptoPort } from "./application/auth-ports";
import type { KmsPort } from "./application/ports";
import type { ThreatIntelResolver } from "./application/threat-ports";
import type { ThreatVerdict } from "./domain/threat-intel";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}
const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };
const body = <T>(r: { body: unknown }): T => r.body as T;

/**
 * H-3 (G-SEC-2) — the composition accepts production KMS/crypto/threat-intel overrides at the same seam the
 * H-2 identity binding uses, so mounting the security service with a cloud provider requires no context
 * change. Here a stub cloud threat resolver flows through the wired `CheckThreatIndicator` unchanged.
 */
describe("H-3 provider overrides (composition seam)", () => {
  it("uses an injected threat-intel resolver for indicator checks", async () => {
    const cloudThreat: ThreatIntelResolver = {
      providerNames: () => ["cloud-feed"],
      lookupAll: async (indicator: string): Promise<readonly ThreatVerdict[]> => [
        { indicator, malicious: true, score: 97, categories: ["c2"], source: "cloud-feed" },
      ],
    };
    const app = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: sequentialIds(),
      clock,
      threatIntel: cloudThreat,
    });

    const result = body<{ malicious: boolean; score: number; providers: string[] }>(
      await app.security.checkThreatIndicator({ indicator: "1.2.3.4" }),
    );
    expect(result.malicious).toBe(true);
    expect(result.score).toBe(97);
    expect(result.providers).toEqual(["cloud-feed"]);
  });

  it("accepts KMS + crypto overrides without disturbing the wiring", () => {
    const noopKms: KmsPort = {
      generateKeyRef: async (p) => `stub://${p}`,
      rotate: async (r) => `${r}#next`,
      fingerprint: async () => "fp_stub",
    };
    const passthroughCrypto: CryptoPort = {
      hash: async (v) => `h:${v}`,
      verifyHash: async (v, h) => h === `h:${v}`,
      encrypt: async (p) => `e:${p}`,
      decrypt: async (c) => c.replace(/^e:/, ""),
      sign: async (p) => `s:${p}`,
      verify: async (p, s) => s === `s:${p}`,
      wrapKey: async (m) => `w:${m}`,
      unwrapKey: async (w) => w.replace(/^w:/, ""),
      randomToken: async () => "token",
    };
    expect(() =>
      wireSecurity({
        serializer: new InMemoryEventSerializer(),
        idGenerator: sequentialIds(),
        clock,
        kms: noopKms,
        crypto: passthroughCrypto,
      }),
    ).not.toThrow();
  });
});
