import { cookies, headers } from "next/headers";
import { trustedClientIp } from "@/lib/client-ip";
import { CLICK_COOKIE, readClickJar } from "@/lib/edge-capture";
import { isMasterId, MASTER_COOKIE } from "@/lib/edge-identity";
import type { CheckoutTracking } from "@/lib/runtime-api";
import { isSessionId, VISITOR_SESSION_COOKIE } from "@/lib/visitor-session";

/**
 * The attribution snapshot of a visitor (Tracking P2-D8), read on the SERVER from what the browser sent with this
 * request: the first-party cookie jar and the request headers. It is what the checkout `complete` call carries so the
 * later server-side Purchase can name the visitor, their click ids and their browser ids; the lead form forwards the
 * same visitor id, click ids and UTM labels.
 *
 * ## Trust
 *
 * Nothing here takes a value from a caller. The server actions that use it accept no tracking argument at all (a
 * hostile client calling the action with extra arguments changes nothing), and every value is re-validated:
 *
 * - `_mb_id` must have the shape the middleware mints; anything else is left out.
 * - `_mb_clk` is the HttpOnly click jar. A script cannot write it, and `readClickJar` still re-validates every entry
 *   (name, value shape and length, platform window, no future time).
 * - `_fbp _fbc _ttp _scid _ga` are the vendors' own cookies, forwarded only when non-empty and within 512 characters
 *   (an identifier cut short matches nothing, so a longer one is left out rather than truncated).
 * - The visitor's address is the trusted proxy hop (`trustedClientIp`), never the left-most `X-Forwarded-For` value.
 *
 * The runtime sanitises again (it is a public API). This reader reads nothing from the database and calls nothing:
 * a failure of any kind yields `undefined`, never an exception, because a checkout must never fail on tracking.
 */

const COOKIE_NAMES = [
  ["fbp", "_fbp"],
  ["fbc", "_fbc"],
  ["ttp", "_ttp"],
  ["scid", "_scid"],
  ["ga", "_ga"],
] as const;
const UTM_PARAMS = [
  ["source", "utm_source"],
  ["medium", "utm_medium"],
  ["campaign", "utm_campaign"],
  ["content", "utm_content"],
  ["term", "utm_term"],
] as const;

const MAX_COOKIE = 512;
const MAX_URL = 2048;
const MAX_UA = 512;
const MAX_LABEL = 200;

interface CookieSource {
  get(name: string): { readonly value: string } | undefined;
}
interface HeaderSource {
  get(name: string): string | null;
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/gu;

function utmOf(page: string | undefined): CheckoutTracking["utm"] {
  if (page === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(page);
  } catch {
    return undefined;
  }
  const utm: Record<string, string> = {};
  for (const [key, param] of UTM_PARAMS) {
    const raw = url.searchParams.get(param);
    const value = raw === null ? "" : raw.replace(CONTROL, "").trim().slice(0, MAX_LABEL);
    if (value !== "") utm[key] = value;
  }
  return Object.keys(utm).length === 0 ? undefined : utm;
}

/** Pure: the snapshot for one request, or `undefined` when the request carried nothing worth keeping. */
export function trackingSnapshotFrom(
  jar: CookieSource,
  requestHeaders: HeaderSource,
  nowMs: number,
): CheckoutTracking | undefined {
  const visitor = jar.get(MASTER_COOKIE)?.value;
  const session = jar.get(VISITOR_SESSION_COOKIE)?.value;

  const cookieValues: Record<string, string> = {};
  for (const [key, name] of COOKIE_NAMES) {
    const value = jar.get(name)?.value;
    if (value !== undefined && value !== "" && value.length <= MAX_COOKIE)
      cookieValues[key] = value;
  }

  const clicks = readClickJar(jar.get(CLICK_COOKIE)?.value, nowMs);
  const clickIds = Object.entries(clicks).flatMap(([name, click]) =>
    click === undefined
      ? []
      : [{ name, value: click.v, capturedAt: new Date(click.t).toISOString() }],
  );

  const ip = trustedClientIp(requestHeaders);
  const userAgentRaw = requestHeaders.get("user-agent")?.trim() ?? "";
  const refererRaw = requestHeaders.get("referer")?.trim() ?? "";
  const pageUrl =
    refererRaw !== "" && refererRaw.length <= MAX_URL && /^https?:\/\//iu.test(refererRaw)
      ? refererRaw
      : undefined;
  const utm = utmOf(pageUrl);

  const snapshot: CheckoutTracking = {
    ...(isMasterId(visitor) ? { visitorId: visitor } : {}),
    ...(isSessionId(session) ? { sessionId: session } : {}),
    ...(ip === null ? {} : { ip }),
    ...(userAgentRaw === "" || userAgentRaw.length > MAX_UA ? {} : { userAgent: userAgentRaw }),
    ...(pageUrl === undefined ? {} : { pageUrl }),
    ...(Object.keys(cookieValues).length === 0 ? {} : { cookies: cookieValues }),
    ...(clickIds.length === 0 ? {} : { clickIds }),
    ...(utm === undefined ? {} : { utm }),
  };
  return Object.keys(snapshot).length === 0 ? undefined : snapshot;
}

/** The current request's snapshot (server actions and route handlers). Never throws. */
export async function readTrackingSnapshot(
  nowMs: number = Date.now(),
): Promise<CheckoutTracking | undefined> {
  try {
    return trackingSnapshotFrom(await cookies(), await headers(), nowMs);
  } catch {
    return undefined;
  }
}
