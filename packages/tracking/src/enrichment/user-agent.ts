/**
 * In-house user-agent parsing (Tracking P1-D8, gap B2): browser family, OS family, device type and the bot
 * markers the bot score reads. No dependency and no maintained database — a short, ordered rule list covering the
 * browsers the shop's visitors really use (Chrome, Safari, Samsung Internet, Firefox, Edge, Opera and, for Egypt
 * and MENA mobile traffic, the in-app browsers of Facebook, Instagram, TikTok and Snapchat).
 *
 * ## Honest limits
 *
 * Chromium's UA reduction freezes the minor version and the device model on many Android builds, so `deviceModel`
 * is present only when the UA still carries it, and `deviceBrand` is inferred from well-known model prefixes only.
 * Absent means unknown — never a guess. The RAW user agent stays on the event untouched (every conversions API
 * wants it verbatim); these fields are an addition, not a replacement.
 */

import type { DeviceType } from "../envelope/technical-context";

export type BotMarkerKind = "crawler" | "http_client" | "headless" | "monitor";

export interface BotMarker {
  readonly kind: BotMarkerKind;
  /** The matched token, lower-cased (`googlebot`, `python-requests`, `headlesschrome`, …). */
  readonly name: string;
}

export interface UserAgentInfo {
  readonly browserName?: string;
  readonly browserVersion?: string;
  readonly osName?: string;
  readonly osVersion?: string;
  readonly deviceType: DeviceType;
  readonly deviceBrand?: string;
  readonly deviceModel?: string;
  /** Present when the UA announces itself as a crawler, an HTTP client, a headless browser or a monitor. */
  readonly bot?: BotMarker;
}

// --------------------------------------------------------------------------------------------- bot markers

const MARKER_RULES: readonly { readonly kind: BotMarkerKind; readonly pattern: RegExp }[] = [
  // Headless / automation first: `HeadlessChrome` also contains `Chrome` and would otherwise read as a browser.
  {
    kind: "headless",
    pattern:
      /(headlesschrome|phantomjs|puppeteer|playwright|selenium|webdriver|nightmare|cypress|chrome-lighthouse|lighthouse|pagespeed|gtmetrix)/u,
  },
  {
    kind: "http_client",
    pattern:
      /(?:^|[\s(])(curl|wget|python-requests|python-urllib|python-httpx|aiohttp|httpx|go-http-client|okhttp|apache-httpclient|libwww-perl|node-fetch|undici|axios|postmanruntime|insomnia|httpie|reqwest|guzzlehttp|restsharp|java|jakarta|scrapy|mechanize)(?:[/\s;)]|$)/u,
  },
  {
    kind: "monitor",
    pattern:
      /(uptimerobot|pingdom|statuscake|site24x7|newrelicpinger|datadog|zabbix|nagios|catchpoint|checkly|betteruptime|amazon cloudfront|google-cloud|googlestackdriver|route53|health-?check)/u,
  },
  // `bot\b` with NO leading boundary on purpose (every real crawler token is a suffix: Googlebot, bingbot,
  // AhrefsBot); the trailing boundary keeps device names like `Cubot_X30` (a phone) out.
  {
    kind: "crawler",
    pattern:
      /(googlebot|bingbot|duckduckbot|baiduspider|yandex(bot|images|metrika)|slurp|sogou|exabot|facebot|facebookexternalhit|ia_archiver|applebot|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|perplexitybot|ccbot|amazonbot|bot\b|crawl|spider|scrape)/u,
  },
];

function botMarkerOf(lower: string): BotMarker | undefined {
  for (const rule of MARKER_RULES) {
    const match = rule.pattern.exec(lower);
    if (match !== null) {
      const name = (match[1] ?? match[0]).trim().replace(/[/\s;()]+$/u, "");
      return { kind: rule.kind, name };
    }
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------------ browser

interface BrowserRule {
  readonly name: string;
  readonly pattern: RegExp;
}

/** Ordered: the first match wins, so the specific fork precedes the engine it embeds. */
const BROWSER_RULES: readonly BrowserRule[] = [
  { name: "Edge", pattern: /\b(?:edg|edga|edgios|edge)\/([\d.]+)/iu },
  { name: "Opera", pattern: /\b(?:opr|opera|opt)\/([\d.]+)/iu },
  { name: "Samsung Internet", pattern: /samsungbrowser\/([\d.]+)/iu },
  { name: "UC Browser", pattern: /ucbrowser\/([\d.]+)/iu },
  { name: "Facebook", pattern: /\bfba[nv]\/([\d.]+)|fb_iab\/\w+;fbav\/([\d.]+)/iu },
  { name: "Instagram", pattern: /instagram[ /]([\d.]+)/iu },
  {
    name: "TikTok",
    pattern:
      /musical_ly[\s\S]*?app_version\/([\d.]+)|app_version\/([\d.]+)|musical_ly|bytedancewebview|tiktok/iu,
  },
  { name: "Snapchat", pattern: /snapchat\/([\d.]+)/iu },
  { name: "Firefox", pattern: /\b(?:firefox|fxios)\/([\d.]+)/iu },
  { name: "Chrome", pattern: /\b(?:chrome|crios)\/([\d.]+)/iu },
  { name: "Safari", pattern: /version\/([\d.]+).*safari\//iu },
  { name: "Internet Explorer", pattern: /(?:msie |trident\/.*rv:)([\d.]+)/iu },
];

function browserOf(ua: string): { name?: string; version?: string } {
  for (const rule of BROWSER_RULES) {
    const match = rule.pattern.exec(ua);
    if (match !== null) {
      const version = match.slice(1).find((part) => part !== undefined && part !== "");
      return { name: rule.name, ...(version === undefined ? {} : { version }) };
    }
  }
  return {};
}

// ------------------------------------------------------------------------------------------------------ OS

const WINDOWS_NT: Readonly<Record<string, string>> = {
  "10.0": "10",
  "6.3": "8.1",
  "6.2": "8",
  "6.1": "7",
  "6.0": "Vista",
  "5.1": "XP",
};

function osOf(ua: string): { name?: string; version?: string } {
  const windows = /windows nt ([\d.]+)/iu.exec(ua);
  if (windows !== null) {
    const mapped = WINDOWS_NT[windows[1] as string];
    return { name: "Windows", ...(mapped === undefined ? {} : { version: mapped }) };
  }
  const android = /android[ /]([\d.]+)/iu.exec(ua);
  if (android !== null) return { name: "Android", version: android[1] };
  if (/android/iu.test(ua)) return { name: "Android" };
  const ios = /(?:iphone|cpu) os ([\d_]+)|ipados ([\d_]+)/iu.exec(ua);
  if (ios !== null && /iphone|ipad|ipod/iu.test(ua)) {
    const version = (ios[1] ?? ios[2] ?? "").replace(/_/gu, ".");
    return { name: "iOS", ...(version === "" ? {} : { version }) };
  }
  if (/iphone|ipad|ipod/iu.test(ua)) return { name: "iOS" };
  const mac = /mac os x ([\d_.]+)/iu.exec(ua);
  if (mac !== null) return { name: "macOS", version: (mac[1] as string).replace(/_/gu, ".") };
  if (/cros /iu.test(ua)) return { name: "Chrome OS" };
  if (/linux|x11/iu.test(ua)) return { name: "Linux" };
  return {};
}

// ---------------------------------------------------------------------------------------------- device

/** Model-prefix → brand, for the Android makers that dominate Egyptian and MENA traffic. */
const BRAND_PREFIXES: readonly { readonly brand: string; readonly pattern: RegExp }[] = [
  { brand: "Samsung", pattern: /^(sm-|gt-|sch-|sgh-)/iu },
  { brand: "Google", pattern: /^pixel/iu },
  { brand: "Xiaomi", pattern: /^(redmi|poco|mi |mi-|m\d{4}[a-z]\d|\d{7}[a-z]{1,2}$)/iu },
  { brand: "OPPO", pattern: /^(cph|oppo)/iu },
  { brand: "Realme", pattern: /^(rmx|realme)/iu },
  { brand: "Vivo", pattern: /^(vivo|v\d{4})/iu },
  { brand: "Tecno", pattern: /^tecno/iu },
  { brand: "Infinix", pattern: /^infinix/iu },
  { brand: "itel", pattern: /^itel/iu },
  { brand: "Huawei", pattern: /^(huawei|[a-z]{3}-[a-z]\d{2})/iu },
  { brand: "Honor", pattern: /^(honor|hry-|nth-)/iu },
  { brand: "OnePlus", pattern: /^(oneplus|[a-z]{2}\d{4}$)/iu },
  { brand: "Motorola", pattern: /^(moto|xt\d{4})/iu },
  { brand: "Nokia", pattern: /^nokia/iu },
  { brand: "Lenovo", pattern: /^lenovo/iu },
];

function androidModel(ua: string): string | undefined {
  // `Linux; Android 13; SM-G991B Build/TP1A…)` or `Linux; Android 13; SM-G991B)`; Chromium's reduced UA uses `K`.
  const match = /android [\d.]+; ([^;)]+?)(?: build\/|\)|;)/iu.exec(ua);
  const model = match?.[1]?.trim();
  if (
    model === undefined ||
    model === "" ||
    model === "K" ||
    /^(wv|mobile|tablet)$/iu.test(model)
  ) {
    return undefined;
  }
  return model;
}

interface DeviceInfo {
  readonly type: DeviceType;
  readonly brand?: string;
  readonly model?: string;
}

function deviceOf(ua: string, lower: string): DeviceInfo {
  if (/\bipad\b/u.test(lower)) return { type: "tablet", brand: "Apple", model: "iPad" };
  if (/\biphone\b/u.test(lower)) return { type: "mobile", brand: "Apple", model: "iPhone" };
  if (/\bipod\b/u.test(lower)) return { type: "mobile", brand: "Apple", model: "iPod" };

  if (/android/u.test(lower)) {
    // Tablet before mobile: an Android tablet's UA says `android` WITHOUT `mobile`.
    const type: DeviceType = /\bmobile\b/u.test(lower) ? "mobile" : "tablet";
    const model = androidModel(ua);
    const brand =
      model === undefined
        ? undefined
        : BRAND_PREFIXES.find((candidate) => candidate.pattern.test(model))?.brand;
    return {
      type,
      ...(brand === undefined ? {} : { brand }),
      ...(model === undefined ? {} : { model }),
    };
  }
  if (/\b(tablet|playbook|silk)\b/u.test(lower)) return { type: "tablet" };
  if (/\b(mobile|windows phone|iemobile|opera mini|blackberry)\b/u.test(lower)) {
    return { type: "mobile" };
  }
  if (/\b(smart-?tv|appletv|googletv|crkey|hbbtv|tizen|webos|roku)\b/u.test(lower)) {
    return { type: "tv" };
  }
  if (/\b(windows|macintosh|mac os x|linux|cros|x11)\b/u.test(lower)) return { type: "desktop" };
  return { type: "unknown" };
}

// -------------------------------------------------------------------------------------------- the parser

/**
 * Parses a raw `User-Agent`. An absent or empty one is `deviceType: "unknown"` with no marker — calling it a bot
 * here would reclassify privacy-tool users as crawlers; the bot SCORE weighs the absence instead.
 */
export function parseUserAgent(raw: string | null | undefined): UserAgentInfo {
  const ua = (raw ?? "").trim();
  if (ua === "") return { deviceType: "unknown" };
  const lower = ua.toLowerCase();

  const bot = botMarkerOf(lower);
  const browser = browserOf(ua);
  const os = osOf(ua);
  const device: DeviceInfo = bot === undefined ? deviceOf(ua, lower) : { type: "bot" };

  return {
    ...(browser.name === undefined ? {} : { browserName: browser.name }),
    ...(browser.version === undefined ? {} : { browserVersion: browser.version }),
    ...(os.name === undefined ? {} : { osName: os.name }),
    ...(os.version === undefined ? {} : { osVersion: os.version }),
    deviceType: device.type,
    ...(device.brand === undefined ? {} : { deviceBrand: device.brand }),
    ...(device.model === undefined ? {} : { deviceModel: device.model }),
    ...(bot === undefined ? {} : { bot }),
  };
}
