import { describe, expect, it } from "vitest";
import { BOT_SKIP_THRESHOLD, botBand, scoreBot, type BotSignals } from "./bot-score";
import { parseUserAgent } from "./user-agent";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36";

function signals(userAgent: string | null, extra: Partial<BotSignals> = {}): BotSignals {
  return { userAgent, ua: parseUserAgent(userAgent), ...extra };
}

describe("scoreBot — bands", () => {
  it("an ordinary browser with its headers is 0 / human", () => {
    const result = scoreBot(
      signals(CHROME, { acceptLanguage: "ar-EG,ar;q=0.9,en;q=0.8", secChUa: '"Chromium";v="126"' }),
    );
    expect(result).toEqual({ score: 0, band: "human", reasons: [] });
  });

  it("a declared crawler is a certain bot", () => {
    const result = scoreBot(
      signals("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", {
        acceptLanguage: "en",
      }),
    );
    expect(result.score).toBe(100);
    expect(result.band).toBe("certain_bot");
    expect(result.reasons).toEqual(["declared_crawler"]);
  });

  it.each([
    ["curl/8.4.0", "http_client"],
    ["python-requests/2.31.0", "http_client"],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
      "headless_browser",
    ],
  ])("%s is over the skip threshold (%s)", (ua, reason) => {
    const result = scoreBot(signals(ua, { acceptLanguage: "en" }));
    expect(result.reasons).toContain(reason);
    expect(result.score).toBeGreaterThanOrEqual(BOT_SKIP_THRESHOLD);
    expect(result.band === "bot" || result.band === "certain_bot").toBe(true);
  });

  it("a monitoring tool is over the threshold", () => {
    const result = scoreBot(
      signals("Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)", {
        acceptLanguage: "en",
      }),
    );
    expect(result.reasons).toEqual(["monitoring_tool"]);
    expect(result.score).toBe(70);
  });

  it("no user agent at all is over the threshold, but no mainstream-browser signal is needed", () => {
    const result = scoreBot(signals(null));
    expect(result.reasons).toEqual(["missing_user_agent"]);
    expect(result.score).toBeGreaterThanOrEqual(BOT_SKIP_THRESHOLD);
    expect(scoreBot(signals("   ")).reasons).toEqual(["missing_user_agent"]);
  });

  it("one missing header on an otherwise normal browser stays below the threshold", () => {
    const result = scoreBot(signals(ANDROID, { acceptLanguage: null }));
    expect(result.reasons).toEqual(["missing_accept_language"]);
    expect(result.score).toBe(25);
    expect(result.band).toBe("suspicious");
    expect(result.score).toBeLessThan(BOT_SKIP_THRESHOLD);
  });

  it("a stub user agent with no language header crosses the threshold together", () => {
    const result = scoreBot(signals("Mozilla/5.0", { acceptLanguage: null }));
    expect(result.reasons).toEqual(["implausible_user_agent", "missing_accept_language"]);
    expect(result.score).toBeGreaterThanOrEqual(BOT_SKIP_THRESHOLD);
  });

  it("Chromium without Client Hints costs a little, and only when the field was observed", () => {
    expect(scoreBot(signals(CHROME, { acceptLanguage: "en", secChUa: null })).reasons).toEqual([
      "missing_client_hints",
    ]);
    // Not forwarded by an older storefront ⇒ no verdict at all.
    expect(scoreBot(signals(CHROME)).reasons).toEqual([]);
    // iOS Chrome / Safari / Firefox never send them.
    expect(
      scoreBot(
        signals(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
          { acceptLanguage: "ar", secChUa: null },
        ),
      ).reasons,
    ).toEqual([]);
  });

  it("a visitor burst alone crosses the threshold; a fingerprint burst alone never does", () => {
    expect(scoreBot(signals(CHROME, { acceptLanguage: "en", visitorBurst: true })).score).toBe(60);
    const fingerprint = scoreBot(signals(CHROME, { acceptLanguage: "en", fingerprintBurst: true }));
    expect(fingerprint.score).toBe(20);
    expect(fingerprint.score).toBeLessThan(BOT_SKIP_THRESHOLD);
  });

  it("caps at 100", () => {
    const result = scoreBot(
      signals("curl/8.4.0", { acceptLanguage: null, visitorBurst: true, fingerprintBurst: true }),
    );
    expect(result.score).toBe(100);
  });

  it("band edges", () => {
    expect(botBand(0)).toBe("human");
    expect(botBand(19)).toBe("human");
    expect(botBand(20)).toBe("suspicious");
    expect(botBand(49)).toBe("suspicious");
    expect(botBand(50)).toBe("bot");
    expect(botBand(79)).toBe("bot");
    expect(botBand(80)).toBe("certain_bot");
    expect(botBand(100)).toBe("certain_bot");
  });
});

describe("scoreBot — CGNAT (Egyptian mobile carrier NAT)", () => {
  it("never reads an address, so a thousand real phones behind one IP all score the same as one", () => {
    // The input type has no IP field; this pins that a shared address cannot raise a score.
    const input = signals(ANDROID, {
      acceptLanguage: "ar-EG,ar;q=0.9",
      secChUa: '"Chromium";v="125"',
    });
    expect("ip" in input).toBe(false);
    const scores = Array.from({ length: 1000 }, () => scoreBot(input).score);
    expect(new Set(scores)).toEqual(new Set([0]));
  });

  it("a burst on a SHARED fingerprint alone (everyone on the cell with the same phone) is not skipped", () => {
    const result = scoreBot(
      signals(ANDROID, {
        acceptLanguage: "ar-EG",
        secChUa: '"Chromium";v="125"',
        fingerprintBurst: true,
      }),
    );
    expect(result.score).toBeLessThan(BOT_SKIP_THRESHOLD);
    expect(result.band).toBe("suspicious");
  });

  it("a shared-fingerprint burst plus one missing header is still below the threshold", () => {
    const result = scoreBot(signals(ANDROID, { acceptLanguage: null, fingerprintBurst: true }));
    expect(result.score).toBe(45);
    expect(result.score).toBeLessThan(BOT_SKIP_THRESHOLD);
  });
});
