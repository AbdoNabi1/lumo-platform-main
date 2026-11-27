/**
 * TrackingProfile (Tracking P1-D4): what the platform remembers about a visitor so that a LATER server
 * event — a Purchase placed days after the ad click, a lead saved from a form — still leaves with the click ids,
 * browser ids and match keys the vendors need, none of which that event carries by itself.
 *
 * ## What it holds, and what it never will
 *
 * - **Hashes only.** The email in the form each platform wants (`emailStd`, `emailGads`, `emailGa4`), the phone
 *   with and without its `+` (`phoneE164`, `phoneDigits`), first/last name, city, state, country and the external
 *   id, all SHA-256 hex. A raw email, phone or name never enters this type, so it can never reach a table, a log
 *   or an export through it.
 * - **Click ids with the time they were captured** — a click id is only forwardable inside its platform's window
 *   (`click-ids.ts`), and the capture time is what lets a later event judge that.
 * - Browser ids (`_fbp`, `_fbc`, `_ttp`, `_scid`, GA client/session), the last IP / user agent / page (a server
 *   event has none of its own), the last landing touch, and the lead and order ids the profile produced.
 *
 * ## Identity and merging
 *
 * A profile is keyed by `(tenantId, visitorId)`. One person on two devices, or one device after cookies were
 * cleared, is two cookies — resolution (`profile-resolver.ts`) folds them into ONE profile by customer id, email
 * hash or phone hash. The surviving profile keeps its own `visitorId`; every other cookie id becomes an alias
 * that resolves to it (`mergedInto`, stored as a data-free tombstone).
 */

import type { ClickIdName } from "../envelope/click-ids";

/** Anonymous profiles live this long after the visitor was last seen (owner decision, 2026-11-27). */
export const PROFILE_TTL_DAYS = 400;
export const PROFILE_TTL_MS = PROFILE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** IP and user agent inside event records are nulled once a record is this old (owner decision). */
export const EVENT_NETWORK_RETENTION_DAYS = 90;

/** Upper bound on a stored click id value. TikTok allows 1000 characters; anything longer is not a click id. */
export const MAX_CLICK_ID_LENGTH = 2048;

/** A profile never remembers more than this many lead / order ids (newest by id order are kept). */
export const MAX_PROFILE_REFERENCES = 200;

export interface ProfileClickId {
  readonly value: string;
  /** ISO-8601 UTC instant the click was captured. */
  readonly capturedAt: string;
}

/** Click ids by registry name; a name that is absent was never captured (or expired). */
export type ProfileClickIds = Partial<Record<ClickIdName, ProfileClickId>>;

/** SHA-256 hex digests, one slot per form a platform wants. Absent = unknown, never an empty-string hash. */
export interface ProfileHashes {
  readonly emailStd?: string;
  readonly emailGads?: string;
  readonly emailGa4?: string;
  readonly phoneDigits?: string;
  readonly phoneE164?: string;
  readonly fn?: string;
  readonly ln?: string;
  readonly ct?: string;
  readonly st?: string;
  readonly country?: string;
  readonly externalId?: string;
}

export const PROFILE_HASH_KEYS = [
  "emailStd",
  "emailGads",
  "emailGa4",
  "phoneDigits",
  "phoneE164",
  "fn",
  "ln",
  "ct",
  "st",
  "country",
  "externalId",
] as const satisfies readonly (keyof ProfileHashes)[];

export interface ProfileBrowserIds {
  readonly fbp?: string;
  readonly fbc?: string;
  /** When `fbc` was captured; `fbc` is only forwarded inside Meta's 90-day window. */
  readonly fbcCapturedAt?: string;
  readonly ttp?: string;
  readonly scid?: string;
  readonly gaClientId?: string;
  readonly gaSessionId?: string;
}

export const PROFILE_BROWSER_ID_KEYS = [
  "fbp",
  "ttp",
  "scid",
  "gaClientId",
  "gaSessionId",
] as const satisfies readonly (keyof ProfileBrowserIds)[];

/** The campaign the visitor arrived with last. A visit with no campaign signal does not replace it. */
export interface ProfileLandingTouch {
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly utmContent?: string;
  readonly utmTerm?: string;
  readonly referrer?: string;
  readonly pageUrl?: string;
  /** Reserved for the AI-referrer table (P1 T4); never set by this module. */
  readonly aiSource?: string;
  /** ISO-8601 UTC instant of the touch. */
  readonly at: string;
}

export interface ProfileGeo {
  readonly country?: string;
  readonly region?: string;
  readonly city?: string;
}

export interface TrackingProfile {
  readonly tenantId: string;
  readonly visitorId: string;
  readonly customerId?: string;

  readonly hashes: ProfileHashes;
  readonly clickIds: ProfileClickIds;
  readonly browser: ProfileBrowserIds;

  readonly lastIp?: string;
  readonly lastUserAgent?: string;
  readonly lastPageUrl?: string;
  readonly lastSeenAt: string;

  readonly geo?: ProfileGeo;
  readonly landing?: ProfileLandingTouch;
  /** Filled by P1 T4 (bot scoring, cookieless id); carried and merged here so no later migration is needed. */
  readonly botScore?: number;
  readonly fingerprintId?: string;

  /** Sorted, de-duplicated. */
  readonly leadIds: readonly string[];
  readonly orderIds: readonly string[];

  /** Optimistic-lock counter: 0 for a profile that was never stored. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

/** `expires_at` for a profile last seen at `lastSeenAt`. */
export function expiresAtFor(lastSeenAt: string): string {
  return new Date(Date.parse(lastSeenAt) + PROFILE_TTL_MS).toISOString();
}

/** True for a profile that is not tied to a customer — the only kind the retention job may delete. */
export function isAnonymousProfile(profile: Pick<TrackingProfile, "customerId">): boolean {
  return profile.customerId === undefined;
}

/** True when the profile carries nothing a delivery could use (a bare cookie seen once, say). */
export function hasMatchKeys(hashes: ProfileHashes): boolean {
  return PROFILE_HASH_KEYS.some((key) => hashes[key] !== undefined);
}

/** The keys identity resolution looks a profile up by, in the order they are tried. */
export interface ProfileLookupKeys {
  readonly customerId?: string;
  readonly emailStd?: string;
  readonly phoneE164?: string;
  readonly visitorId?: string;
}

/**
 * Everything one event teaches the profile. Built from an envelope by `observationFromEnvelope`; the profile
 * merge (`applyObservation`) is the only consumer.
 */
export interface ProfileObservation {
  readonly tenantId: string;
  readonly visitorId?: string;
  readonly customerId?: string;
  /** The instant this event was seen — becomes `lastSeenAt` (never moves a profile's clock backwards). */
  readonly at: string;
  readonly hashes: ProfileHashes;
  readonly clickIds: ProfileClickIds;
  readonly browser: ProfileBrowserIds;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly pageUrl?: string;
  readonly landing?: ProfileLandingTouch;
  readonly leadIds: readonly string[];
  readonly orderIds: readonly string[];
}
