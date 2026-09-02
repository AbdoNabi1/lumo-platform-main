/**
 * Collector resolution primitives (P0-1) — client IP, user agent, cookies.
 *
 * These live in `@platform/tracking` rather than in the collector app for one reason: doc 09
 * specifies **two** first-party collection points, a Node collector and a Cloudflare Worker edge
 * beacon. If this logic lived in the app, the edge beacon would grow a second implementation, and
 * the two would disagree about which IP is the client's — producing different geo, different match
 * quality and different rate-limit buckets for the same visitor depending on which endpoint they
 * hit. One implementation, two adapters.
 *
 * Everything here is pure and free of runtime globals (no `process`, no `Request`, no `document`),
 * so the same code runs in Node, in a browser bundle and in a V8 isolate — the constraint the rest
 * of this package already holds itself to.
 */

import type { DeviceType } from "../envelope/technical-context";

/** Reads one request header, lower-cased name. Adapters supply the transport's accessor. */
export type HeaderLookup = (name: string) => string | undefined;

/** Reads one cookie by name. */
export type CookieLookup = (name: string) => string | undefined;

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------

/**
 * How far to trust `X-Forwarded-For`.
 *
 * **This is a security boundary, not a configuration nicety.** `X-Forwarded-For` is a client-settable
 * header. A collector that takes the left-most entry — the common shortcut, and what most examples
 * show — lets any visitor claim any IP address. That is not a cosmetic problem: the client IP feeds
 * geo resolution, every conversions API's match quality, and the abuse rate-limit bucket. A spoofed
 * IP means a visitor can attribute themselves to another country, poison match rates, and evade rate
 * limiting by rotating a header.
 *
 * Only the hops *we* operate append trustworthy values, and they append on the right. So the client
 * address is the entry `trustedProxyCount` positions from the **right**, and everything to the left
 * of it is attacker-controlled text. With `trustedProxyCount: 0` the header is ignored entirely and
 * the socket peer address is used — the correct behaviour when nothing sits in front of the
 * collector, and the correct default.
 */
export interface ClientIpPolicy {
  /** Number of proxies/load balancers we operate in front of this collector. Default 0. */
  readonly trustedProxyCount: number;
}

export interface ResolvedClientIp {
  readonly ip: string | undefined;
  /** How it was determined — carried so a wrong geo can be diagnosed rather than guessed at. */
  readonly basis: "socket" | "forwarded" | "unavailable";
}

/**
 * Resolves the client address from the socket peer and `X-Forwarded-For`.
 *
 * Returns `unavailable` rather than a placeholder when nothing is resolvable. An empty IP is honest;
 * `"0.0.0.0"` or the proxy's own address would be silently wrong in a field that vendors use for
 * matching, and nothing downstream could tell the difference.
 */
export function resolveClientIp(
  headers: HeaderLookup,
  remoteAddress: string | undefined,
  policy: ClientIpPolicy = { trustedProxyCount: 0 },
): ResolvedClientIp {
  const socketIp = normalizeIp(remoteAddress);

  if (policy.trustedProxyCount <= 0) {
    return socketIp === undefined
      ? { ip: undefined, basis: "unavailable" }
      : { ip: socketIp, basis: "socket" };
  }

  const forwarded = (headers("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => normalizeIp(part))
    .filter((part): part is string => part !== undefined);

  // Count from the right: the right-most entry was appended by our closest proxy. With N trusted
  // proxies the client sits N positions in. If the chain is shorter than we expect, the header did
  // not traverse the topology we configured — fall back to the socket rather than trusting a
  // position that does not mean what we think it means.
  const index = forwarded.length - policy.trustedProxyCount;
  const candidate = index >= 0 ? forwarded[index] : undefined;

  if (candidate !== undefined) return { ip: candidate, basis: "forwarded" };
  return socketIp === undefined
    ? { ip: undefined, basis: "unavailable" }
    : { ip: socketIp, basis: "socket" };
}

/** Trims, unwraps IPv6 brackets, strips a trailing port, and maps IPv4-in-IPv6 to plain IPv4. */
function normalizeIp(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let ip = value.trim();
  if (ip === "") return undefined;

  // `[2001:db8::1]:443` — bracketed IPv6 with an optional port.
  const bracketed = /^\[(?<inner>[^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed?.groups?.inner !== undefined) ip = bracketed.groups.inner;

  // `203.0.113.7:443` — IPv4 with a port. A bare IPv6 address also contains colons, so only strip
  // when there is exactly one, which an IPv6 address never has.
  if ((ip.match(/:/g) ?? []).length === 1 && ip.includes(".")) ip = ip.slice(0, ip.indexOf(":"));

  // `::ffff:203.0.113.7` — the IPv4-mapped IPv6 form Node reports on dual-stack sockets.
  const mapped = /^::ffff:(?<v4>\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.groups?.v4 !== undefined) ip = mapped.groups.v4;

  return ip === "" ? undefined : ip;
}

// ---------------------------------------------------------------------------
// User agent
// ---------------------------------------------------------------------------

export interface ResolvedUserAgent {
  /** The raw header, carried verbatim — this is what every conversions API actually requires. */
  readonly clientUserAgent: string | undefined;
  readonly deviceType: DeviceType;
}

/**
 * Classifies the user agent.
 *
 * **Deliberately shallow, and the shallowness is the point.** Full UA parsing — browser name,
 * version, OS, device brand and model — is a maintained-database problem, not a regex problem, and a
 * hand-rolled approximation would populate `browserName`/`osVersion` with values that are wrong for
 * a long tail of real traffic while looking authoritative in a dashboard. So this resolves only what
 * can be decided reliably from substrings, and leaves the richer `TechnicalContext` fields unset for
 * a UA library to fill later if the need is ever real.
 *
 * Bot detection is included because it changes what the event *means*: forwarding crawler traffic to
 * a conversions API degrades match quality and inflates counts. Classifying is not filtering —
 * routing rules decide what to do with a `bot`, and that decision stays in the registry.
 */
export function resolveUserAgent(headers: HeaderLookup): ResolvedUserAgent {
  const raw = headers("user-agent");
  if (raw === undefined || raw.trim() === "") {
    // Absent UA is itself a signal — no mainstream browser omits it — but "unknown" is the honest
    // classification. Calling it a bot would silently reclassify privacy-tool users as crawlers.
    return { clientUserAgent: undefined, deviceType: "unknown" };
  }

  const ua = raw.trim();
  const lower = ua.toLowerCase();

  // `bot\b` with NO leading boundary, deliberately: every real crawler token is a suffix —
  // `Googlebot`, `bingbot`, `AhrefsBot` — so `\bbot\b` matches none of them. The trailing boundary
  // still does the work that matters, keeping device names like `Cubot_X30` (a phone, not a
  // crawler) out, since `_` is a word character and blocks the match.
  if (/bot\b|crawl|spider|slurp|headlesschrome|phantomjs/.test(lower)) {
    return { clientUserAgent: ua, deviceType: "bot" };
  }
  // Tablet before mobile: an iPad's UA contains neither "mobile" nor "android" reliably, while an
  // Android tablet's contains "android" WITHOUT "mobile" — checking mobile first would mislabel it.
  if (/\bipad\b|\btablet\b|(android(?!.*\bmobile\b))/.test(lower)) {
    return { clientUserAgent: ua, deviceType: "tablet" };
  }
  if (/\b(iphone|ipod|mobile|android)\b/.test(lower)) {
    return { clientUserAgent: ua, deviceType: "mobile" };
  }
  if (/\b(smart-?tv|appletv|googletv|crkey)\b/.test(lower)) {
    return { clientUserAgent: ua, deviceType: "tv" };
  }
  if (/\b(windows|macintosh|mac os x|linux|cros)\b/.test(lower)) {
    return { clientUserAgent: ua, deviceType: "desktop" };
  }

  return { clientUserAgent: ua, deviceType: "unknown" };
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

/** First-party cookie names the collector reads and writes. Configuration, not scattered literals. */
export const COLLECTOR_COOKIES = {
  /** Our first-party visitor id — stable across sessions. */
  visitorId: "lumo_vid",
  /** Our first-party session id — rolls with the session window. */
  sessionId: "lumo_sid",
  /** Meta's browser id cookie, set by the Meta pixel when present. */
  fbp: "_fbp",
  /** Meta's click cookie; derivable from `fbclid` when the pixel has not set it. */
  fbc: "_fbc",
} as const;

export interface ResolvedCookies {
  readonly visitorId: string | undefined;
  readonly sessionId: string | undefined;
  readonly fbp: string | undefined;
  readonly fbc: string | undefined;
}

export function resolveCookies(cookies: CookieLookup): ResolvedCookies {
  const read = (name: string): string | undefined => {
    const value = cookies(name);
    return value === undefined || value.trim() === "" ? undefined : value.trim();
  };

  return {
    visitorId: read(COLLECTOR_COOKIES.visitorId),
    sessionId: read(COLLECTOR_COOKIES.sessionId),
    fbp: read(COLLECTOR_COOKIES.fbp),
    fbc: read(COLLECTOR_COOKIES.fbc),
  };
}

/**
 * Builds Meta's `_fbc` value from a click id, in the format Meta documents: `fb.1.<ms>.<fbclid>`.
 *
 * Derived only when the cookie is genuinely absent. If the Meta pixel already set `_fbc`, that value
 * wins — it carries the click timestamp from the actual click, whereas a value derived here carries
 * *this* request's timestamp, which is later and can push the event outside the click's attribution
 * window. Deriving is a recovery path for pixel-less or cookie-blocked pages, not an improvement.
 */
export function deriveFbc(fbclid: string, atMs: number): string {
  return `fb.1.${String(atMs)}.${fbclid}`;
}

/** Parses a `Cookie` header into a lookup. Adapters with native cookie parsing should use theirs. */
export function parseCookieHeader(header: string | undefined): CookieLookup {
  const jar = new Map<string, string>();

  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    // First wins: a duplicated cookie name usually means a host-scoped and a domain-scoped cookie
    // are both present, and browsers send the more specific one first.
    if (name !== "" && !jar.has(name)) jar.set(name, decodeCookieValue(value));
  }

  return (name: string): string | undefined => jar.get(name);
}

function decodeCookieValue(value: string): string {
  const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  try {
    return decodeURIComponent(unquoted);
  } catch {
    // A malformed percent-escape is not worth rejecting a whole event over; the raw value is still
    // usable as an opaque id, which is all any of these cookies are.
    return unquoted;
  }
}
