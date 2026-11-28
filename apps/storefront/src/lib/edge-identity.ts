import type { NextRequest, NextResponse } from "next/server";
import { trustedClientIp } from "./client-ip";
import {
  CLICK_COOKIE,
  CLICK_COOKIE_TTL_SECONDS,
  captureLanding,
  externalReferrer,
  fbclidOfFbc,
  isDocumentRequest,
  looksAutomated,
  mergeClickJar,
  readClickJar,
  writeClickJar,
  type ClickName,
  type LandingCapture,
} from "./edge-capture";
import {
  sendTrackingEvent,
  trackingEdgeSecret,
  type SendTrackingEventResult,
  type TrackingCookieDirective,
} from "./tracking-edge";
import { VISITOR_SESSION_COOKIE } from "./visitor-session";

/**
 * Edge identity (Tracking P1-D5 + P1-D6), the middleware half: the master cookie, the click-id cookie, `_fbc`, and
 * the ONE signed background `touch` event.
 *
 * Nothing here waits on the network. A plain page view of a returning visitor reads cookies and sets cookies — no
 * fetch, no database. Only a landing that carries a click id or campaign parameter, or a brand-new visitor, hands one
 * signed `visitor_touch` event to `waitUntil` (after the response is on its way). A page is never held by tracking,
 * and a failure of any part of this is swallowed: the shop must render.
 *
 * ## The cookies
 *
 * - `_mb_id` — the master visitor cookie: a UUID, 400 days, Secure, SameSite=Lax, on the shop's OWN host and set by
 *   this server response (so Safari ITP's 7-day cap on script-written cookies does not apply). Not HttpOnly, because
 *   the P3 browser SDK reads it. Minted only on a page navigation and only when absent, so parallel asset requests
 *   cannot race each other into several ids; an existing one is re-issued (its 400 days slide) on page navigations.
 * - `_mb_clk` — the latest click id per platform, JSON, 90 days, HttpOnly (`edge-capture.ts`). A server-side backup
 *   for conversions placed days after the landing; scripts have no business reading it.
 * - `_fbc` — Meta's click cookie, derived from a landing's `fbclid` when the browser has none for that click.
 *
 * Cookies are host-only (no `Domain`): a `www` and an apex host of one shop are two visitors until a redirect joins
 * them — the price of never writing a cookie a public-suffix rule could reject.
 *
 * ## Cookie Keeper (restore)
 *
 * The touch's answer carries the vendor cookies the browser lost and the visitor's profile still holds. The page the
 * touch belongs to has already been sent, so they are kept briefly in this process and set on that visitor's NEXT
 * request (best effort, 5 minutes: a restart or a second instance simply loses them; the next landing asks again).
 * A returning visitor on a plain page with no campaign signal is not asked — that is the price of "no network call on
 * a normal page view"; the P3 SDK's collect call restores for them.
 */
export const MASTER_COOKIE = "_mb_id";
export const MASTER_TTL_SECONDS = 400 * 24 * 60 * 60;

const MASTER_ID = /^[A-Za-z0-9_-]{16,48}$/u;
/** Every cookie the runtime may ask us to restore; anything else in its answer is ignored. */
export const RESTORABLE_COOKIES: ReadonlySet<string> = new Set([
  "_fbp",
  "_fbc",
  "_ttp",
  "ttclid",
  "_scid",
  "_scclid",
  "_ga",
  "_gcl_aw",
  "li_fat_id",
  "_epik",
]);
const RESTORE_VALUE = /^[A-Za-z0-9._~:+=/%-]{1,1000}$/u;
const MAX_RESTORE_SECONDS = MASTER_TTL_SECONDS;

const PENDING_TTL_MS = 5 * 60_000;
const PENDING_MAX = 2000;
const THROTTLE_MS = 60_000;
const THROTTLE_MAX = 5000;
const META_FBC_TTL_SECONDS = 90 * 24 * 60 * 60;

const pendingRestores = new Map<
  string,
  { cookies: readonly TrackingCookieDirective[]; at: number }
>();
const touchThrottle = new Map<string, number>();

/** Test hook: forget everything this process remembers. */
export function resetEdgeIdentityState(): void {
  pendingRestores.clear();
  touchThrottle.clear();
}

const isProduction = (env: NodeJS.ProcessEnv): boolean => env["NODE_ENV"] === "production";

function cookieOptions(env: NodeJS.ProcessEnv, maxAge: number, httpOnly: boolean) {
  return {
    path: "/",
    maxAge,
    sameSite: "lax" as const,
    secure: isProduction(env),
    httpOnly,
  };
}

function bounded<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done === true) return;
    map.delete(oldest.value);
  }
}

/** `production` for a production build (unless the deployment says it is staging), else `development`. */
export function trackingEnvironment(
  env: NodeJS.ProcessEnv,
): "production" | "staging" | "development" {
  if (env["APP_ENV"] === "staging") return "staging";
  return isProduction(env) ? "production" : "development";
}

/** Signed-body cookie field → the cookie the browser holds it under (what the runtime must not overwrite). */
const PRESENCE_FIELDS: readonly (readonly [string, string])[] = [
  ["fbp", "_fbp"],
  ["fbc", "_fbc"],
  ["ttp", "_ttp"],
  ["scid", "_scid"],
  ["ga", "_ga"],
  ["ttclid", "ttclid"],
  ["scclid", "_scclid"],
  ["gclAw", "_gcl_aw"],
  ["liFatId", "li_fat_id"],
  ["epik", "_epik"],
];

const restoreKey = (shopId: string, visitorId: string): string => `${shopId}\u0000${visitorId}`;

function validRestore(directive: TrackingCookieDirective): boolean {
  return (
    RESTORABLE_COOKIES.has(directive.name) &&
    RESTORE_VALUE.test(directive.value) &&
    Number.isInteger(directive.maxAgeSeconds) &&
    directive.maxAgeSeconds > 0 &&
    directive.maxAgeSeconds <= MAX_RESTORE_SECONDS
  );
}

export interface EdgeCaptureInput {
  readonly request: NextRequest;
  /** The response the middleware is about to return (it already carries the session cookie). */
  readonly response: NextResponse;
  /** The shop the middleware resolved from the host — the only tenant a touch is ever sent for. */
  readonly shopId: string;
  /** `NextFetchEvent.waitUntil`; absent ⇒ the send is simply left running. */
  readonly waitUntil?: (promise: Promise<unknown>) => void;
  readonly env?: NodeJS.ProcessEnv;
  readonly nowMs?: number;
  readonly send?: typeof sendTrackingEvent;
}

/** A request header as the runtime's bot score wants it: trimmed, bounded, `null` when absent. */
function headerOrNull(request: NextRequest, name: string, max: number): string | null {
  const value = request.headers.get(name)?.trim();
  return value === undefined || value === "" ? null : value.slice(0, max);
}

function cookie(request: NextRequest, name: string): string | undefined {
  const value = request.cookies.get(name)?.value;
  return value === undefined || value === "" ? undefined : value;
}

/** The event the storefront sends for a touch: no vendor routes it, the profile learns from it. */
function touchEvent(input: {
  readonly nowMs: number;
  readonly env: NodeJS.ProcessEnv;
  readonly landing: LandingCapture;
  readonly referrer: string | undefined;
}): Record<string, unknown> {
  const { nowMs, env, landing, referrer } = input;
  const capturedAt = new Date(nowMs).toISOString();
  const clickIds = (Object.keys(landing.clicks) as ClickName[]).map((name) => ({
    name,
    value: landing.clicks[name],
    capturedAt,
  }));
  return {
    eventId: crypto.randomUUID(),
    eventName: "visitor_touch",
    eventVersion: 1,
    timestamp: capturedAt,
    source: "edge",
    environment: trackingEnvironment(env),
    // Notice-only (owner decision O18): no consent gate, so the snapshot is stamped granted. A touch is routed to
    // no vendor anyway; it only teaches the visitor's profile.
    consent: { analytics: true, marketing: true, personalization: false },
    context: {
      attribution: {
        ...landing.utm,
        ...(referrer === undefined ? {} : { referrer }),
        landingPage: landing.pageUrl,
        ...(clickIds.length === 0 ? {} : { clickIds }),
      },
    },
    properties: {},
  };
}

/**
 * Applies edge capture to a page response. Never throws and never awaits the network.
 * Callers pass only responses for real shop pages (not refusals, redirects to the gate or previews).
 */
export function applyEdgeCapture(input: EdgeCaptureInput): void {
  try {
    capture(input);
  } catch {
    // The page must render; a capture failure is never the visitor's problem.
  }
}

function capture(input: EdgeCaptureInput): void {
  const { request, response, shopId } = input;
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  const userAgent = request.headers.get("user-agent");

  if (looksAutomated(userAgent)) return;
  const document = isDocumentRequest(request.method, request.headers);

  // 1. The master cookie: existing and well-formed ⇒ kept; otherwise minted — on a page navigation only.
  const stored = cookie(request, MASTER_COOKIE);
  const existing = stored !== undefined && MASTER_ID.test(stored) ? stored : undefined;
  if (existing === undefined && !document) return;
  const visitorId = existing ?? crypto.randomUUID();
  const isNew = existing === undefined;
  if (document) {
    response.cookies.set(MASTER_COOKIE, visitorId, cookieOptions(env, MASTER_TTL_SECONDS, false));
  }

  // 2. Cookies restored by an earlier touch of this visitor: set what the browser still lacks.
  const pendingKey = restoreKey(shopId, visitorId);
  const pending = pendingRestores.get(pendingKey);
  if (pending !== undefined) {
    pendingRestores.delete(pendingKey);
    if (nowMs - pending.at <= PENDING_TTL_MS) {
      for (const directive of pending.cookies) {
        if (cookie(request, directive.name) !== undefined || !validRestore(directive)) continue;
        response.cookies.set(
          directive.name,
          directive.value,
          cookieOptions(env, directive.maxAgeSeconds, false),
        );
      }
    }
  }

  if (!document) return;

  // 3. The landing: click ids (native, or swapped in from a backup parameter), campaign, `_fbc`.
  const landing = captureLanding(request.nextUrl, nowMs);
  let fbcForEvent = cookie(request, "_fbc");
  if (landing.fbc !== undefined) {
    const known = fbclidOfFbc(fbcForEvent);
    // A new click replaces the old `_fbc`; the same click keeps the (earlier, more accurate) one.
    if (known !== landing.clicks.fbclid) {
      response.cookies.set("_fbc", landing.fbc, cookieOptions(env, META_FBC_TTL_SECONDS, false));
      fbcForEvent = landing.fbc;
    }
  }
  if (Object.keys(landing.clicks).length > 0) {
    const jar = mergeClickJar(
      readClickJar(cookie(request, CLICK_COOKIE), nowMs),
      landing.clicks,
      nowMs,
    );
    response.cookies.set(
      CLICK_COOKIE,
      writeClickJar(jar),
      cookieOptions(env, CLICK_COOKIE_TTL_SECONDS, true),
    );
  }

  // 4. The touch: a landing with a signal, or a visitor we have never seen.
  if (!landing.hasSignal && !isNew) return;
  if (trackingEdgeSecret(env) === null) return;

  const ip = trustedClientIp(request.headers, env);
  if (!landing.hasSignal) {
    // A new visitor without a signal: cookie-less clients are "new" on every request, so one touch per
    // address + agent per minute is the most a single client can cause.
    const key = `${shopId}\u0000${ip ?? ""}\u0000${userAgent ?? ""}`;
    const last = touchThrottle.get(key);
    if (last !== undefined && nowMs - last < THROTTLE_MS) return;
    touchThrottle.delete(key);
    touchThrottle.set(key, nowMs);
    bounded(touchThrottle, THROTTLE_MAX);
  }

  const referrer = externalReferrer(request.headers.get("referer"), request.headers.get("host"));
  const sessionId = response.cookies.get(VISITOR_SESSION_COOKIE)?.value;
  const cookies: Record<string, string> = { visitorId };
  if (sessionId !== undefined) cookies["sessionId"] = sessionId;
  for (const [field, name] of PRESENCE_FIELDS) {
    const value = name === "_fbc" ? fbcForEvent : cookie(request, name);
    if (value !== undefined) cookies[field] = value;
  }

  const send = input.send ?? sendTrackingEvent;
  const sent: Promise<unknown> = send(
    {
      tenantId: shopId,
      event: touchEvent({ nowMs, env, landing, referrer }),
      client: {
        ip,
        userAgent,
        pageUrl: landing.pageUrl,
        referrer: referrer ?? null,
        acceptLanguage: headerOrNull(request, "accept-language", 256),
        secChUa: headerOrNull(request, "sec-ch-ua", 512),
        host: headerOrNull(request, "host", 255),
        cookies,
      },
    },
    { env },
  )
    .then((result: SendTrackingEventResult) => {
      if (!result.ok || result.cookies.length === 0) return;
      const restorable = result.cookies.filter(validRestore);
      if (restorable.length === 0) return;
      pendingRestores.delete(pendingKey);
      pendingRestores.set(pendingKey, { cookies: restorable, at: nowMs });
      bounded(pendingRestores, PENDING_MAX);
    })
    .catch(() => undefined);

  if (input.waitUntil === undefined) void sent;
  else input.waitUntil(sent);
}
