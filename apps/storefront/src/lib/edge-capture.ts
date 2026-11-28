/**
 * Edge capture, the pure half (Tracking P1-D5, gap A5 Click ID Restorer): what a LANDING request teaches us, read
 * straight off its URL with no network call, no cookie jar and no clock of its own.
 *
 * Imported by the middleware, so it stays Edge-light: no Node-only module, and no `@platform/tracking` (the click-id
 * registry is mirrored below and a test pins every row of it to `CLICK_ID_DEFINITIONS`, so the two cannot drift).
 *
 * ## Click ids, their aliases and the backup parameters
 *
 * Safari/Brave strip some click ids from a URL (and a redirect chain can drop any of them). The merchant (or the
 * admin, which shows the exact suffix per platform) adds a BACKUP parameter next to the native one — `mb_gclid={gclid}`
 * — and when the native one is missing the backup is swapped in. A native parameter always wins over its backup.
 *
 * Names are matched case-insensitively and a platform's documented spellings are all accepted (`ScCid`, `sccid`,
 * `sc_click_id` for Snapchat). The canonical key is the registry's (`scclid`), and the page URL the runtime sees is
 * rewritten so the registry's own parameter (`ScCid`) is present: the runtime's extraction is exact-name.
 *
 * ## `_fbc`
 *
 * Meta's click cookie is `fb.<subdomain index>.<creation time ms>.<fbclid>`; derived here only from a fbclid on the
 * landing, with the landing's own time (the click happened an instant earlier).
 */

export const CLICK_NAMES = [
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "ttclid",
  "msclkid",
  "scclid",
  "twclid",
  "li_fat_id",
  "epik",
] as const;
export type ClickName = (typeof CLICK_NAMES)[number];

interface ClickSpec {
  /** The registry's URL parameter: what the runtime looks for on the page URL. */
  readonly param: string;
  readonly platform: string;
  readonly ttlDays: number;
  /** Longest value kept. Longer is not a click id and is never truncated (a cut id matches nothing). */
  readonly maxLength: number;
  /** Lower-case native spellings accepted on a landing URL. */
  readonly aliases: readonly string[];
}

export const CLICK_SPECS: Readonly<Record<ClickName, ClickSpec>> = {
  fbclid: { param: "fbclid", platform: "meta", ttlDays: 90, maxLength: 512, aliases: ["fbclid"] },
  gclid: { param: "gclid", platform: "google", ttlDays: 90, maxLength: 512, aliases: ["gclid"] },
  gbraid: { param: "gbraid", platform: "google", ttlDays: 90, maxLength: 512, aliases: ["gbraid"] },
  wbraid: { param: "wbraid", platform: "google", ttlDays: 90, maxLength: 512, aliases: ["wbraid"] },
  // TikTok's click id can be long: kept whole up to 1000 characters.
  ttclid: {
    param: "ttclid",
    platform: "tiktok",
    ttlDays: 90,
    maxLength: 1000,
    aliases: ["ttclid"],
  },
  msclkid: {
    param: "msclkid",
    platform: "microsoft",
    ttlDays: 90,
    maxLength: 512,
    aliases: ["msclkid"],
  },
  // Snap appends `ScCid`; its docs and tag templates also spell it `sc_click_id`.
  scclid: {
    param: "ScCid",
    platform: "snapchat",
    ttlDays: 28,
    maxLength: 512,
    aliases: ["sccid", "sc_click_id", "scclid"],
  },
  twclid: { param: "twclid", platform: "x", ttlDays: 30, maxLength: 512, aliases: ["twclid"] },
  li_fat_id: {
    param: "li_fat_id",
    platform: "linkedin",
    ttlDays: 90,
    maxLength: 512,
    aliases: ["li_fat_id"],
  },
  epik: { param: "epik", platform: "pinterest", ttlDays: 90, maxLength: 512, aliases: ["epik"] },
};

/** Backup parameter prefix: `mb_gclid`, `mb_fbclid`, `mb_ttclid`, `mb_sccid`, … */
export const BACKUP_PREFIX = "mb_";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cookie-safe, URL-safe characters only: what real click ids are made of. Anything else is refused. */
const CLICK_VALUE = /^[A-Za-z0-9._~:+=/%-]+$/u;

/** native alias / backup alias (lower case) → canonical click name. */
const NATIVE_INDEX = new Map<string, ClickName>();
const BACKUP_INDEX = new Map<string, ClickName>();
for (const name of CLICK_NAMES) {
  for (const alias of CLICK_SPECS[name].aliases) {
    NATIVE_INDEX.set(alias, name);
    BACKUP_INDEX.set(`${BACKUP_PREFIX}${alias}`, name);
  }
}
/** Every backup spelling, including the canonical-key forms (`mb_scclid`). */
const isBackupParam = (key: string): boolean => BACKUP_INDEX.has(key.toLowerCase());

function acceptClick(name: ClickName, raw: string): string | null {
  const value = raw.trim();
  return value !== "" && value.length <= CLICK_SPECS[name].maxLength && CLICK_VALUE.test(value)
    ? value
    : null;
}

export interface UtmTouch {
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly utmContent?: string;
  readonly utmTerm?: string;
}

export interface LandingCapture {
  /** Click ids by canonical name, native or restored from a backup parameter. */
  readonly clicks: Readonly<Partial<Record<ClickName, string>>>;
  /** The subset that came from a backup parameter (the native one was missing or unusable). */
  readonly restoredFromBackup: readonly ClickName[];
  readonly utm: UtmTouch;
  /** The landing URL with backup parameters removed and the native parameter present (≤ 2048 chars). */
  readonly pageUrl: string;
  /** Meta's click cookie value when the landing carries a fbclid. */
  readonly fbc?: string;
  /** True when the landing carries any click id or campaign parameter. */
  readonly hasSignal: boolean;
}

const MAX_PAGE_URL = 2048;
const MAX_UTM = 200;
const UTM_PARAMS: readonly (readonly [keyof UtmTouch, string])[] = [
  ["utmSource", "utm_source"],
  ["utmMedium", "utm_medium"],
  ["utmCampaign", "utm_campaign"],
  ["utmContent", "utm_content"],
  ["utmTerm", "utm_term"],
];

/** `fb.1.<ms>.<fbclid>` (Meta's documented `_fbc` format). */
export function deriveFbc(fbclid: string, atMs: number): string {
  return `fb.1.${String(atMs)}.${fbclid}`;
}

/** The fbclid inside an `_fbc` value, or null when it has another shape. */
export function fbclidOfFbc(fbc: string | undefined): string | null {
  const match = fbc === undefined ? null : /^fb\.\d+\.\d{10,}\.(.+)$/u.exec(fbc);
  return match?.[1] ?? null;
}

/** Control characters out, trimmed, bounded: a campaign label can be shown in an admin screen later. */
function cleanLabel(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const value = raw.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return value === "" ? undefined : value.slice(0, MAX_UTM);
}

/**
 * Reads a landing URL. `url` is not modified. Every query key is matched case-insensitively and the FIRST
 * occurrence of a key wins (a visitor cannot smuggle a second value past the first).
 */
export function captureLanding(url: URL, nowMs: number): LandingCapture {
  // `URLSearchParams` turns `+` into a space; no click id contains a real space, so keep the plus.
  const params = new URLSearchParams(url.search.replace(/\+/gu, "%2B"));
  const first = new Map<string, string>();
  for (const [key, value] of params) {
    const lower = key.toLowerCase();
    if (!first.has(lower)) first.set(lower, value);
  }

  const clicks: Partial<Record<ClickName, string>> = {};
  const restored: ClickName[] = [];
  for (const name of CLICK_NAMES) {
    const spec = CLICK_SPECS[name];
    let native: string | null = null;
    for (const alias of spec.aliases) {
      const value = first.get(alias);
      native = value === undefined ? null : acceptClick(name, value);
      if (native !== null) break;
    }
    if (native !== null) {
      clicks[name] = native;
      continue;
    }
    for (const alias of spec.aliases) {
      const value = first.get(`${BACKUP_PREFIX}${alias}`);
      const backup = value === undefined ? null : acceptClick(name, value);
      if (backup !== null) {
        clicks[name] = backup;
        restored.push(name);
        break;
      }
    }
  }

  const utm: Record<string, string> = {};
  for (const [field, param] of UTM_PARAMS) {
    const value = cleanLabel(first.get(param));
    if (value !== undefined) utm[field] = value;
  }

  // The page URL the runtime extracts click ids from: backups gone, the registry's own parameter present.
  const clean = new URL(url.toString());
  clean.hash = "";
  for (const key of [...new Set(clean.searchParams.keys())]) {
    if (isBackupParam(key)) clean.searchParams.delete(key);
  }
  for (const name of CLICK_NAMES) {
    const value = clicks[name];
    if (value !== undefined && clean.searchParams.get(CLICK_SPECS[name].param) !== value) {
      clean.searchParams.set(CLICK_SPECS[name].param, value);
    }
  }
  const pageUrl = clean.toString().slice(0, MAX_PAGE_URL);

  const fbclid = clicks.fbclid;
  return {
    clicks,
    restoredFromBackup: restored,
    utm,
    pageUrl,
    ...(fbclid === undefined ? {} : { fbc: deriveFbc(fbclid, nowMs) }),
    hasSignal: Object.keys(clicks).length > 0 || Object.keys(utm).length > 0,
  };
}

// ---------------------------------------------------------------------------------------------- `_mb_clk`

/** One stored click: the value and the instant (epoch ms) it was captured. */
export interface StoredClick {
  readonly v: string;
  readonly t: number;
}
export type ClickJar = Partial<Record<ClickName, StoredClick>>;

/** The first-party cookie that keeps the latest click per platform (HttpOnly, 90 days). */
export const CLICK_COOKIE = "_mb_clk";
export const CLICK_COOKIE_TTL_SECONDS = 90 * 24 * 60 * 60;
/** A browser holds 4096 bytes per cookie, name and encoding included; stay well inside it. */
const MAX_ENCODED_COOKIE = 3500;

/**
 * Reads the cookie. Every entry is validated again (the browser can edit its cookies) and one past its platform's
 * attribution window, or dated in the future, is dropped. Never throws.
 */
export function readClickJar(raw: string | undefined, nowMs: number): ClickJar {
  if (raw === undefined || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const jar: ClickJar = {};
  for (const name of CLICK_NAMES) {
    const entry = (parsed as Record<string, unknown>)[name];
    if (typeof entry !== "object" || entry === null) continue;
    const { v, t } = entry as { v?: unknown; t?: unknown };
    if (typeof v !== "string" || typeof t !== "number" || !Number.isFinite(t)) continue;
    const value = acceptClick(name, v);
    const age = nowMs - t;
    if (value === null || age < 0 || age > CLICK_SPECS[name].ttlDays * DAY_MS) continue;
    jar[name] = { v: value, t };
  }
  return jar;
}

/**
 * Folds a landing's clicks into the jar. A click on a platform REPLACES everything the jar held for that platform
 * (Google's gclid, gbraid and wbraid are alternatives of one click, so a new gclid must not keep an old wbraid);
 * platforms the landing did not mention are untouched.
 */
export function mergeClickJar(
  jar: ClickJar,
  clicks: Readonly<Partial<Record<ClickName, string>>>,
  nowMs: number,
): ClickJar {
  const landed = new Set(
    CLICK_NAMES.filter((name) => clicks[name] !== undefined).map(
      (name) => CLICK_SPECS[name].platform,
    ),
  );
  const merged: ClickJar = {};
  for (const name of CLICK_NAMES) {
    const kept = jar[name];
    if (kept !== undefined && !landed.has(CLICK_SPECS[name].platform)) merged[name] = kept;
    const fresh = clicks[name];
    if (fresh !== undefined) merged[name] = { v: fresh, t: nowMs };
  }
  return merged;
}

/** The cookie value: compact JSON, oldest clicks dropped first if it would not fit in a cookie. */
export function writeClickJar(jar: ClickJar): string {
  const entries = CLICK_NAMES.flatMap((name) => {
    const entry = jar[name];
    return entry === undefined ? [] : [[name, entry] as const];
  }).sort((a, b) => b[1].t - a[1].t);
  while (entries.length > 0) {
    const json = JSON.stringify(Object.fromEntries(entries));
    if (encodeURIComponent(json).length <= MAX_ENCODED_COOKIE) return json;
    entries.pop();
  }
  return "{}";
}

// ---------------------------------------------------------------------------------------------- requests

const BOT_AGENT =
  /(?:^|[^a-z])(?:[a-z]*bot|crawler|spider|slurp|lighthouse|pagespeed|facebookexternalhit|whatsapp|curl|wget|python-requests|go-http-client|okhttp|httpclient|monitor|uptime)(?:[^a-z]|$)|headless/iu;

/**
 * A cheap guard so crawlers (which keep no cookies, so every hit would be a "new visitor") do not create profiles and
 * events. It is NOT the bot score — that is T4's, at collect time; this only decides whether the storefront bothers.
 */
export function looksAutomated(userAgent: string | null): boolean {
  return userAgent === null || userAgent.trim() === "" || BOT_AGENT.test(userAgent);
}

/**
 * A page navigation worth capturing: a GET that wants HTML and is neither a Next.js data/prefetch request nor a
 * browser prefetch. Assets, API calls, server actions and RSC payloads never mint a visitor.
 */
export function isDocumentRequest(
  method: string,
  headers: { get(name: string): string | null },
): boolean {
  if (method !== "GET") return false;
  if (!(headers.get("accept") ?? "").includes("text/html")) return false;
  if (headers.get("rsc") !== null || headers.get("next-router-prefetch") !== null) return false;
  if (headers.get("x-middleware-prefetch") !== null) return false;
  const purpose =
    `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`.toLowerCase();
  return !purpose.includes("prefetch") && !purpose.includes("prerender");
}

/** The referrer when it is another site (the shop's own pages are not a source of anything). */
export function externalReferrer(referer: string | null, host: string | null): string | undefined {
  if (referer === null || referer === "") return undefined;
  try {
    const parsed = new URL(referer);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    if (host !== null && parsed.host.toLowerCase() === host.toLowerCase()) return undefined;
    return referer.slice(0, MAX_PAGE_URL);
  } catch {
    return undefined;
  }
}
