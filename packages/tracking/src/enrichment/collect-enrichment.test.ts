import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TrackingEnvelope } from "../envelope/envelope";
import { BOT_SKIP_THRESHOLD } from "./bot-score";
import { createCollectEnricher, type BurstPort, type CollectSignals } from "./collect-enrichment";
import type { GeoLookupPort } from "./geo-mmdb";

const hmac = (key: string, data: string): string =>
  createHmac("sha256", key).update(data).digest("hex");

const SECRET = "edge-secret-for-tests-".padEnd(40, "0");
const CHROME =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36";

const geo: GeoLookupPort = {
  lookup: (ip) =>
    ip === "41.32.7.9" ? { country: "EG", region: "Cairo Governorate", city: "Cairo" } : null,
};

function event(overrides: Partial<TrackingEnvelope["context"]> = {}): TrackingEnvelope {
  return {
    eventId: "e-1",
    eventName: "page_viewed",
    eventVersion: 1,
    timestamp: "2026-11-28T10:00:00.000Z",
    source: "web",
    consent: { analytics: true, marketing: true, personalization: false },
    context: {
      session: { sessionId: "s-1", visitorId: "v-1" },
      technical: { clientIpAddress: "41.32.7.9", clientUserAgent: CHROME, deviceType: "mobile" },
      ...overrides,
    },
    properties: {},
  };
}

const human: CollectSignals = {
  ip: "41.32.7.9",
  userAgent: CHROME,
  acceptLanguage: "ar-EG,ar;q=0.9,en;q=0.8",
  secChUa: '"Chromium";v="124"',
  host: "shop.example.com",
};

const enricher = createCollectEnricher({ secret: SECRET, hmacSha256Hex: hmac, geo });
const run = (signals: CollectSignals, envelope = event()) =>
  enricher({ tenantId: "t-1", envelope, signals });

describe("collect-time enrichment", () => {
  it("stamps the user agent facts, geo, language, score and fingerprint on a normal visit", async () => {
    const out = await run(human);
    expect(out.context.technical).toMatchObject({
      browserName: "Chrome",
      browserVersion: "124.0.6367.82",
      osName: "Android",
      osVersion: "13",
      deviceType: "mobile",
      deviceBrand: "Samsung",
      deviceModel: "SM-G991B",
      browserLanguage: "ar-EG",
      countryDetected: "EG",
      regionDetected: "Cairo Governorate",
      cityDetected: "Cairo",
      botScore: 0,
      clientUserAgent: CHROME,
    });
    expect(out.context.technical?.fingerprintId).toMatch(/^[0-9a-f]{32}$/u);
    expect(out.context.technical?.botReasons).toBeUndefined();
  });

  it("scores a declared crawler over the skip threshold with its reasons", async () => {
    const out = await run({
      ...human,
      userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    });
    expect(out.context.technical?.botScore).toBeGreaterThanOrEqual(BOT_SKIP_THRESHOLD);
    expect(out.context.technical?.botReasons).toContain("declared_crawler");
    expect(out.context.technical?.deviceType).toBe("bot");
  });

  it("leaves geo fields as they were when there is no database or the address is unknown", async () => {
    const noGeo = createCollectEnricher({
      secret: SECRET,
      hmacSha256Hex: hmac,
      geo: { lookup: () => null },
    });
    const out = await noGeo({ tenantId: "t-1", envelope: event(), signals: human });
    expect(out.context.technical?.countryDetected).toBeUndefined();
    expect(out.context.technical?.botScore).toBe(0);
  });

  it("server-observed geo replaces what the browser claimed", async () => {
    const claimed = event({ technical: { countryDetected: "US", clientUserAgent: CHROME } });
    const out = await run(human, claimed);
    expect(out.context.technical?.countryDetected).toBe("EG");
  });

  it("a visitor burst alone pushes a normal browser over the threshold; a throwing counter costs nothing", async () => {
    const burst: BurstPort = {
      check: async () => ({ visitorBurst: true, fingerprintBurst: false }),
    };
    const bursting = createCollectEnricher({ secret: SECRET, hmacSha256Hex: hmac, geo, burst });
    const out = await bursting({ tenantId: "t-1", envelope: event(), signals: human });
    expect(out.context.technical?.botScore).toBeGreaterThanOrEqual(BOT_SKIP_THRESHOLD);
    expect(out.context.technical?.botReasons).toContain("visitor_burst");

    const errors: string[] = [];
    const failing = createCollectEnricher({
      secret: SECRET,
      hmacSha256Hex: hmac,
      geo,
      burst: {
        check: async () => {
          throw new Error("redis down");
        },
      },
      onError: (stage) => errors.push(stage),
    });
    const safe = await failing({ tenantId: "t-1", envelope: event(), signals: human });
    expect(safe.context.technical?.botScore).toBe(0);
    expect(errors).toEqual(["burst"]);
  });

  it("the burst counter is asked per visitor and per fingerprint, tenant-scoped", async () => {
    const seen: unknown[] = [];
    const spy = createCollectEnricher({
      secret: SECRET,
      hmacSha256Hex: hmac,
      geo,
      burst: {
        check: async (input) => {
          seen.push(input);
          return { visitorBurst: false, fingerprintBurst: false };
        },
      },
    });
    await spy({ tenantId: "t-9", envelope: event(), signals: human });
    expect(seen).toEqual([
      {
        tenantId: "t-9",
        visitorId: "v-1",
        fingerprintId: expect.stringMatching(/^[0-9a-f]{32}$/u),
      },
    ]);
  });

  it("names the AI assistant a visit came from (referrer or utm_source)", async () => {
    const byReferrer = await run(
      human,
      event({ page: { url: "https://shop.example.com/", referrer: "https://chatgpt.com/" } }),
    );
    expect(byReferrer.context.attribution?.aiSource).toBe("chatgpt");
    const byUtm = await run(human, event({ attribution: { utmSource: "perplexity.ai" } }));
    expect(byUtm.context.attribution?.aiSource).toBe("perplexity");
    const none = await run(human, event({ page: { referrer: "https://www.google.com/" } }));
    expect(none.context.attribution?.aiSource).toBeUndefined();
  });

  describe("fingerprint", () => {
    it("is stable for one device and different across stores", async () => {
      const a1 = await enricher({ tenantId: "t-1", envelope: event(), signals: human });
      const a2 = await enricher({ tenantId: "t-1", envelope: event(), signals: human });
      const b = await enricher({ tenantId: "t-2", envelope: event(), signals: human });
      expect(a1.context.technical?.fingerprintId).toBe(a2.context.technical?.fingerprintId);
      expect(b.context.technical?.fingerprintId).not.toBe(a1.context.technical?.fingerprintId);
    });

    it("is absent without the platform secret or without an address", async () => {
      const noSecret = createCollectEnricher({ secret: undefined, hmacSha256Hex: hmac, geo });
      expect(
        (await noSecret({ tenantId: "t-1", envelope: event(), signals: human })).context.technical
          ?.fingerprintId,
      ).toBeUndefined();
      expect((await run({ ...human, ip: null })).context.technical?.fingerprintId).toBeUndefined();
    });

    it("never replaces an id the event already carries when it cannot form one", async () => {
      const carried = event({
        technical: { fingerprintId: "f".repeat(32), clientUserAgent: CHROME },
      });
      const out = await run({ ...human, ip: null }, carried);
      expect(out.context.technical?.fingerprintId).toBe("f".repeat(32));
    });
  });

  it("does not mutate the event it was given", async () => {
    const original = event();
    const snapshot = JSON.stringify(original);
    await run(human, original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
