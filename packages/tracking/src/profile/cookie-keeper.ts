/**
 * Cookie Keeper (Tracking P1-D6, gap A2): which vendor cookies the browser lost that a visitor's profile still
 * remembers, and the exact `Set-Cookie` lifetimes to give them back with.
 *
 * Safari's ITP caps cookies written by JavaScript (`_fbp`, `_ttp`, `_ga`, …) at 7 days; a cookie the SERVER sets on
 * the shop's own domain is not capped. The storefront re-emits what this returns as first-party `Set-Cookie`.
 *
 * Rules, each pinned by a test:
 * - **Only what the request lacked.** A cookie the browser still holds is never touched — whatever it holds is at
 *   least as fresh as what we remember (the event that carried it already updated the profile).
 * - **Only what we have seen.** The profile holds `_fbp/_fbc/_ttp/_scid/GA client id` and the click ids; nothing is
 *   invented. `_gcl_au` and `uet_vid` are on the vendor list but are not stored on a profile, so they are never
 *   restored (stated in the report, not hidden).
 * - **Lifetimes are Stape's documented ones** (`group-a.md` A2 table), additionally clamped to the platform's own
 *   attribution window: a click id past its window (or an `_fbc` older than Meta's 90 days) is not restored, and a
 *   restored one never outlives that window.
 * - **Tenant-bound.** A profile of another tenant, and an expired profile, restore nothing.
 */

import { CLICK_ID_DEFINITIONS, fbcCreatedAtMs, type ClickIdName } from "../envelope/click-ids";
import type { CookieDirective } from "../collector/collector";
import type { TrackingProfile } from "./tracking-profile";

const DAY_SECONDS = 24 * 60 * 60;
/** Stape's "13 months" is stored as 395 days (Chromium caps a cookie at 400). */
const THIRTEEN_MONTHS_DAYS = 395;

/** Every cookie name the keeper may emit. The storefront refuses anything outside this list. */
export const COOKIE_KEEPER_NAMES = [
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
] as const;

export type CookieKeeperName = (typeof COOKIE_KEEPER_NAMES)[number];

/** The longest value emitted: TikTok's `ttclid` may be 1000 characters, every other id is far shorter. */
export const COOKIE_KEEPER_MAX_VALUE = 1000;
/** Cookie-safe characters only: no `;`, `,`, quotes, spaces or control characters can ever reach a header. */
const SAFE_VALUE = /^[A-Za-z0-9._~:+=/%-]+$/u;
const GA_CLIENT_ID = /^\d{1,20}\.\d{1,20}$/u;

/** Name → lifetime in days (Stape A2 table). */
const LIFETIME_DAYS: Readonly<Record<CookieKeeperName, number>> = {
  _fbp: 90,
  _fbc: 90,
  _ttp: THIRTEEN_MONTHS_DAYS,
  ttclid: 30,
  _scid: 400,
  _scclid: 90,
  _ga: THIRTEEN_MONTHS_DAYS,
  _gcl_aw: 90,
  li_fat_id: 90,
  _epik: 90,
};

/** Cookie name → the click-id registry entry that backs it. */
const CLICK_COOKIES: readonly {
  readonly cookie: CookieKeeperName;
  readonly clickId: ClickIdName;
}[] = [
  { cookie: "ttclid", clickId: "ttclid" },
  { cookie: "_scclid", clickId: "scclid" },
  { cookie: "li_fat_id", clickId: "li_fat_id" },
  { cookie: "_epik", clickId: "epik" },
];

function isSafe(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length > 0 &&
    value.length <= COOKIE_KEEPER_MAX_VALUE &&
    SAFE_VALUE.test(value)
  );
}

export interface CookieKeeperInput {
  readonly tenantId: string;
  readonly profile: TrackingProfile;
  /** The cookie names the request carried (non-empty). */
  readonly present: ReadonlySet<string>;
  readonly now: Date;
}

/**
 * Seconds a restored cookie may live: its documented lifetime, but never past the end of the value's own
 * attribution window (`windowEndMs`, absent = no window).
 */
function lifetimeSeconds(
  name: CookieKeeperName,
  nowMs: number,
  windowEndMs: number | undefined,
): number {
  const documented = LIFETIME_DAYS[name] * DAY_SECONDS;
  if (windowEndMs === undefined) return documented;
  return Math.min(documented, Math.floor((windowEndMs - nowMs) / 1000));
}

/** The vendor cookies this visitor's browser lacks and the profile can give back. Pure; never throws. */
export function restorableCookies(input: CookieKeeperInput): readonly CookieDirective[] {
  const { tenantId, profile, present, now } = input;
  if (profile.tenantId !== tenantId) return [];
  const nowMs = now.getTime();
  if (Date.parse(profile.expiresAt) < nowMs) return [];

  const out: CookieDirective[] = [];
  const emit = (name: CookieKeeperName, value: string | undefined, windowEndMs?: number): void => {
    if (present.has(name) || !isSafe(value)) return;
    const maxAgeSeconds = lifetimeSeconds(name, nowMs, windowEndMs);
    if (maxAgeSeconds > 0) out.push({ name, value, maxAgeSeconds });
  };

  const { browser } = profile;
  emit("_fbp", browser.fbp);

  if (browser.fbc !== undefined) {
    // Meta's window starts when the click happened: the time stamped into the value, else when we captured it.
    const startMs = fbcCreatedAtMs(browser.fbc) ?? Date.parse(browser.fbcCapturedAt ?? "");
    const windowMs = CLICK_ID_DEFINITIONS.fbclid.ttlDays * DAY_SECONDS * 1000;
    emit("_fbc", browser.fbc, Number.isNaN(startMs) ? undefined : startMs + windowMs);
  }

  emit("_ttp", browser.ttp);
  emit("_scid", browser.scid);

  if (browser.gaClientId !== undefined && GA_CLIENT_ID.test(browser.gaClientId)) {
    emit("_ga", `GA1.1.${browser.gaClientId}`);
  }

  const windowEnd = (
    click: { readonly capturedAt: string },
    name: ClickIdName,
  ): number | undefined => {
    const captured = Date.parse(click.capturedAt);
    return Number.isNaN(captured)
      ? undefined
      : captured + CLICK_ID_DEFINITIONS[name].ttlDays * DAY_SECONDS * 1000;
  };

  for (const { cookie, clickId } of CLICK_COOKIES) {
    const click = profile.clickIds[clickId];
    if (click !== undefined) emit(cookie, click.value, windowEnd(click, clickId));
  }

  // Google's `_gcl_aw` is `GCL.<click time in seconds>.<gclid>`; gbraid/wbraid have their own cookies we do not own.
  const gclid = profile.clickIds.gclid;
  if (gclid !== undefined && isSafe(gclid.value)) {
    const captured = Date.parse(gclid.capturedAt);
    if (!Number.isNaN(captured)) {
      emit(
        "_gcl_aw",
        `GCL.${String(Math.floor(captured / 1000))}.${gclid.value}`,
        windowEnd(gclid, "gclid"),
      );
    }
  }

  return out;
}
