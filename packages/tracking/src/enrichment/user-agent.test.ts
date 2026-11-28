import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./user-agent";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID_SAMSUNG =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.165 Mobile Safari/537.36";
const CHROME_ANDROID_REDUCED =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

describe("parseUserAgent — browsers, OS, devices", () => {
  it("Chrome on Windows", () => {
    expect(parseUserAgent(CHROME_WIN)).toEqual({
      browserName: "Chrome",
      browserVersion: "126.0.0.0",
      osName: "Windows",
      osVersion: "10",
      deviceType: "desktop",
    });
  });

  it("Safari on iPhone", () => {
    expect(parseUserAgent(SAFARI_IPHONE)).toEqual({
      browserName: "Safari",
      browserVersion: "17.5",
      osName: "iOS",
      osVersion: "17.5",
      deviceType: "mobile",
      deviceBrand: "Apple",
      deviceModel: "iPhone",
    });
  });

  it("Chrome on a Samsung phone carries model and brand when the UA still has them", () => {
    expect(parseUserAgent(CHROME_ANDROID_SAMSUNG)).toMatchObject({
      browserName: "Chrome",
      osName: "Android",
      osVersion: "13",
      deviceType: "mobile",
      deviceBrand: "Samsung",
      deviceModel: "SM-G991B",
    });
  });

  it("UA-reduced Android Chrome has no model — absent, never guessed", () => {
    const info = parseUserAgent(CHROME_ANDROID_REDUCED);
    expect(info.deviceType).toBe("mobile");
    expect(info.osName).toBe("Android");
    expect(info.deviceModel).toBeUndefined();
    expect(info.deviceBrand).toBeUndefined();
  });

  it("an Android UA without `Mobile` is a tablet", () => {
    const info = parseUserAgent(
      "Mozilla/5.0 (Linux; Android 12; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    expect(info.deviceType).toBe("tablet");
  });

  it("iPad is a tablet", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      ),
    ).toMatchObject({ deviceType: "tablet", osName: "iOS", deviceModel: "iPad" });
  });

  it.each([
    [
      "Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
      "Edge",
      "126.0.2592.87",
    ],
    [
      "Opera",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0",
      "Opera",
      "111.0.0.0",
    ],
    [
      "Samsung Internet",
      "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36",
      "Samsung Internet",
      "24.0",
    ],
    [
      "Firefox",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
      "Firefox",
      "127.0",
    ],
    [
      "Chrome on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
      "Chrome",
      "126.0.6478.153",
    ],
  ])("%s", (_label, ua, name, version) => {
    expect(parseUserAgent(ua)).toMatchObject({ browserName: name, browserVersion: version });
  });

  it("recognises the in-app browsers that dominate social traffic", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Linux; Android 12; SM-A525F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.46.119;]",
      ).browserName,
    ).toBe("Facebook");
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E219 Instagram 330.0.0.20.116 (iPhone14,5; iOS 17_4)",
      ).browserName,
    ).toBe("Instagram");
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Linux; Android 13; TECNO KG5k Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 musical_ly_2023405030 JsSdk/2.0 app_version/34.5.3 BytedanceWebview/d8a21c6",
      ),
    ).toMatchObject({ browserName: "TikTok", browserVersion: "34.5.3" });
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.80.0.40 (like Safari/8618.2.12.10.7, panda)",
      ).browserName,
    ).toBe("Snapchat");
  });

  it("names Egypt-market handset brands from their model prefix", () => {
    const brandOf = (model: string): string | undefined =>
      parseUserAgent(
        `Mozilla/5.0 (Linux; Android 13; ${model} Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36`,
      ).deviceBrand;
    expect(brandOf("TECNO KG5k")).toBe("Tecno");
    expect(brandOf("RMX3363")).toBe("Realme");
    expect(brandOf("CPH2371")).toBe("OPPO");
    expect(brandOf("Redmi Note 11")).toBe("Xiaomi");
    expect(brandOf("Pixel 7 Pro")).toBe("Google");
  });

  it("absent or empty UA is unknown, not a bot", () => {
    expect(parseUserAgent(undefined)).toEqual({ deviceType: "unknown" });
    expect(parseUserAgent(null)).toEqual({ deviceType: "unknown" });
    expect(parseUserAgent("   ")).toEqual({ deviceType: "unknown" });
  });
});

describe("parseUserAgent — bot markers", () => {
  it.each([
    [
      "Googlebot",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "crawler",
    ],
    ["AhrefsBot", "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", "crawler"],
    [
      "facebookexternalhit",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "crawler",
    ],
    [
      "GPTBot",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1",
      "crawler",
    ],
    ["curl", "curl/8.4.0", "http_client"],
    ["python-requests", "python-requests/2.31.0", "http_client"],
    ["Go-http-client", "Go-http-client/1.1", "http_client"],
    ["okhttp", "okhttp/4.12.0", "http_client"],
    [
      "HeadlessChrome",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
      "headless",
    ],
    ["Lighthouse", "Mozilla/5.0 (Linux; Android 11; moto g power) Chrome-Lighthouse", "headless"],
    [
      "UptimeRobot",
      "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)",
      "monitor",
    ],
  ])("%s is flagged %s", (_label, ua, kind) => {
    const info = parseUserAgent(ua);
    expect(info.bot?.kind).toBe(kind);
    expect(info.deviceType).toBe("bot");
    expect(info.bot?.name).not.toBe("");
  });

  it("names the matched token", () => {
    expect(parseUserAgent("curl/8.4.0").bot?.name).toBe("curl");
    expect(
      parseUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)").bot
        ?.name,
    ).toBe("googlebot");
  });

  it("does not flag real browsers or a phone whose name ends in `bot`-like letters", () => {
    expect(parseUserAgent(CHROME_WIN).bot).toBeUndefined();
    expect(parseUserAgent(SAFARI_IPHONE).bot).toBeUndefined();
    expect(parseUserAgent(CHROME_ANDROID_SAMSUNG).bot).toBeUndefined();
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Linux; Android 12; Cubot_X30 Build/SP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      ).bot,
    ).toBeUndefined();
  });
});
