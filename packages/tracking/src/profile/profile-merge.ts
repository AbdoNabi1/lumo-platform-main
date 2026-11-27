/**
 * The profile's pure data rules (Tracking P1-D4): how one event updates a profile, and how two profiles of the
 * same person become one. No I/O, no clock — every instant arrives as an argument, so the rules are testable
 * and, above all, DETERMINISTIC: merging A into B and B into A must produce the same profile, or two workers
 * resolving the same pair of cookies at once would leave the store disagreeing with itself.
 *
 * ## Rules in one place
 *
 * - **Latest wins**, per field: a hash, a browser id, the last IP / user agent / page, the landing touch. A tie on
 *   time is broken by the larger value, never by argument order.
 * - **Click ids: the newest capture per platform wins** (TikTok's own instruction for `ttclid`: override the old
 *   one with each new click). A click id past its platform's window is dropped, not kept "just in case" — the
 *   vendor refuses it and it would only pollute match diagnostics.
 * - **Lead and order ids are a union**, sorted.
 * - **Tenants never mix.** Merging two profiles of different tenants is a programming error and throws.
 * - **Two different customers never merge.** A shared phone or a family laptop must not hand one customer's data
 *   to another's events; merging profiles that name different customer ids throws (the resolver checks first).
 */

import { isClickIdValidAt, type CapturedClickId, type ClickIdName } from "../envelope/click-ids";
import {
  MAX_CLICK_ID_LENGTH,
  MAX_PROFILE_REFERENCES,
  PROFILE_BROWSER_ID_KEYS,
  PROFILE_HASH_KEYS,
  expiresAtFor,
  type ProfileBrowserIds,
  type ProfileClickId,
  type ProfileClickIds,
  type ProfileHashes,
  type ProfileLandingTouch,
  type ProfileObservation,
  type TrackingProfile,
} from "./tracking-profile";

const ms = (iso: string): number => {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** The later of two ISO instants (a malformed one counts as the epoch). */
export function laterInstant(a: string, b: string): string {
  return ms(a) >= ms(b) ? a : b;
}

/**
 * Of two optional values with a time each, the one with the later time; the only value if one is absent; the
 * larger value on an exact tie so the result does not depend on argument order.
 */
function latest<T extends string | number>(
  a: { readonly value: T | undefined; readonly at: string },
  b: { readonly value: T | undefined; readonly at: string },
): T | undefined {
  if (a.value === undefined) return b.value;
  if (b.value === undefined) return a.value;
  if (ms(a.at) !== ms(b.at)) return ms(a.at) > ms(b.at) ? a.value : b.value;
  return String(a.value) >= String(b.value) ? a.value : b.value;
}

function compact<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as T;
}

/** A click id as the registry-shaped value the envelope and `isClickIdValidAt` use. */
export function toCapturedClickId(name: ClickIdName, click: ProfileClickId): CapturedClickId {
  return { name, value: click.value, capturedAt: click.capturedAt };
}

/** Newest capture per platform; on an exact tie the larger value, so merge order cannot matter. */
export function mergeProfileClickIds(a: ProfileClickIds, b: ProfileClickIds): ProfileClickIds {
  const result: Partial<Record<ClickIdName, ProfileClickId>> = {};
  const names = new Set([...Object.keys(a), ...Object.keys(b)] as ClickIdName[]);
  for (const name of names) {
    const left = a[name];
    const right = b[name];
    if (left === undefined) {
      if (right !== undefined) result[name] = right;
    } else if (right === undefined) {
      result[name] = left;
    } else if (ms(left.capturedAt) !== ms(right.capturedAt)) {
      result[name] = ms(left.capturedAt) > ms(right.capturedAt) ? left : right;
    } else {
      result[name] = left.value >= right.value ? left : right;
    }
  }
  return result;
}

/** Drops click ids outside their platform's window at `at`, and any that is empty or absurdly long. */
export function pruneClickIds(clickIds: ProfileClickIds, at: string): ProfileClickIds {
  const kept: Partial<Record<ClickIdName, ProfileClickId>> = {};
  const reference = new Date(ms(at));
  for (const [name, click] of Object.entries(clickIds) as [ClickIdName, ProfileClickId][]) {
    if (click.value === "" || click.value.length > MAX_CLICK_ID_LENGTH) continue;
    if (!isClickIdValidAt(toCapturedClickId(name, click), reference)) continue;
    kept[name] = click;
  }
  return kept;
}

function unionIds(a: readonly string[], b: readonly string[]): readonly string[] {
  const merged = [...new Set([...a, ...b])].sort();
  return merged.length > MAX_PROFILE_REFERENCES ? merged.slice(-MAX_PROFILE_REFERENCES) : merged;
}

function mergeHashes(a: ProfileHashes, aAt: string, b: ProfileHashes, bAt: string): ProfileHashes {
  const result: Record<string, string | undefined> = {};
  for (const key of PROFILE_HASH_KEYS) {
    result[key] = latest({ value: a[key], at: aAt }, { value: b[key], at: bAt });
  }
  return compact(result);
}

function mergeBrowser(a: TrackingProfile, b: TrackingProfile): ProfileBrowserIds {
  const result: Record<string, string | undefined> = {};
  for (const key of PROFILE_BROWSER_ID_KEYS) {
    result[key] = latest(
      { value: a.browser[key], at: a.lastSeenAt },
      { value: b.browser[key], at: b.lastSeenAt },
    );
  }
  // `fbc` is judged by its own capture time: it is the one browser id that expires.
  const fbc = latest(
    { value: a.browser.fbc, at: a.browser.fbcCapturedAt ?? a.lastSeenAt },
    { value: b.browser.fbc, at: b.browser.fbcCapturedAt ?? b.lastSeenAt },
  );
  if (fbc !== undefined) {
    result["fbc"] = fbc;
    // Both sides may hold the same value, captured at different times: the later capture is the truth.
    result["fbcCapturedAt"] = [a, b]
      .filter((side) => side.browser.fbc === fbc)
      .map((side) => side.browser.fbcCapturedAt ?? side.lastSeenAt)
      .reduce(laterInstant);
  }
  return compact(result);
}

function laterLanding(
  a: ProfileLandingTouch | undefined,
  b: ProfileLandingTouch | undefined,
): ProfileLandingTouch | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (ms(a.at) !== ms(b.at)) return ms(a.at) > ms(b.at) ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/** True when merging the two would join two different customers — which must never happen. */
export function customersConflict(
  a: Pick<TrackingProfile, "customerId">,
  b: Pick<TrackingProfile, "customerId">,
): boolean {
  return a.customerId !== undefined && b.customerId !== undefined && a.customerId !== b.customerId;
}

/** The profile that survives a merge: the oldest, the lower cookie id on a tie. */
export function survivorOf(a: TrackingProfile, b: TrackingProfile): TrackingProfile {
  if (ms(a.createdAt) !== ms(b.createdAt)) return ms(a.createdAt) < ms(b.createdAt) ? a : b;
  return a.visitorId <= b.visitorId ? a : b;
}

/**
 * Folds two profiles of one person into one. The survivor keeps its cookie id, its creation time and its
 * `version` (the optimistic lock it will be written back under). Commutative: `merge(a, b)` equals `merge(b, a)`.
 */
export function mergeProfiles(a: TrackingProfile, b: TrackingProfile): TrackingProfile {
  if (a.tenantId !== b.tenantId) {
    throw new Error("tracking profiles of different tenants must never be merged");
  }
  if (customersConflict(a, b)) {
    throw new Error("tracking profiles of different customers must never be merged");
  }

  const survivor = survivorOf(a, b);
  const lastSeenAt = laterInstant(a.lastSeenAt, b.lastSeenAt);
  const customerId = a.customerId ?? b.customerId;
  const geo = {
    country: latest(
      { value: a.geo?.country, at: a.lastSeenAt },
      { value: b.geo?.country, at: b.lastSeenAt },
    ),
    region: latest(
      { value: a.geo?.region, at: a.lastSeenAt },
      { value: b.geo?.region, at: b.lastSeenAt },
    ),
    city: latest(
      { value: a.geo?.city, at: a.lastSeenAt },
      { value: b.geo?.city, at: b.lastSeenAt },
    ),
  };
  const landing = laterLanding(a.landing, b.landing);
  const lastIp = latest(
    { value: a.lastIp, at: a.lastSeenAt },
    { value: b.lastIp, at: b.lastSeenAt },
  );
  const lastUserAgent = latest(
    { value: a.lastUserAgent, at: a.lastSeenAt },
    { value: b.lastUserAgent, at: b.lastSeenAt },
  );
  const lastPageUrl = latest(
    { value: a.lastPageUrl, at: a.lastSeenAt },
    { value: b.lastPageUrl, at: b.lastSeenAt },
  );
  const botScore = latest(
    { value: a.botScore, at: a.lastSeenAt },
    { value: b.botScore, at: b.lastSeenAt },
  );
  const fingerprintId = latest(
    { value: a.fingerprintId, at: a.lastSeenAt },
    { value: b.fingerprintId, at: b.lastSeenAt },
  );

  return compact({
    tenantId: survivor.tenantId,
    visitorId: survivor.visitorId,
    customerId,
    hashes: mergeHashes(a.hashes, a.lastSeenAt, b.hashes, b.lastSeenAt),
    clickIds: pruneClickIds(mergeProfileClickIds(a.clickIds, b.clickIds), lastSeenAt),
    browser: mergeBrowser(a, b),
    lastIp,
    lastUserAgent,
    lastPageUrl,
    lastSeenAt,
    geo: Object.values(geo).some((value) => value !== undefined) ? compact(geo) : undefined,
    landing,
    botScore,
    fingerprintId,
    leadIds: unionIds(a.leadIds, b.leadIds),
    orderIds: unionIds(a.orderIds, b.orderIds),
    version: survivor.version,
    createdAt: ms(a.createdAt) <= ms(b.createdAt) ? a.createdAt : b.createdAt,
    updatedAt: laterInstant(a.updatedAt, b.updatedAt),
    expiresAt: expiresAtFor(lastSeenAt),
  });
}

/** A new, empty, never-stored profile (`version` 0). */
export function createProfile(input: {
  readonly tenantId: string;
  readonly visitorId: string;
  readonly at: string;
  readonly now: string;
}): TrackingProfile {
  return {
    tenantId: input.tenantId,
    visitorId: input.visitorId,
    hashes: {},
    clickIds: {},
    browser: {},
    lastSeenAt: input.at,
    leadIds: [],
    orderIds: [],
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
    expiresAt: expiresAtFor(input.at),
  };
}

/**
 * Applies what one event observed. An event older than the profile's last sighting (a redelivered or reordered
 * message) may only FILL gaps; it never overwrites a newer value, and never moves `lastSeenAt` backwards.
 */
export function applyObservation(
  profile: TrackingProfile,
  observation: ProfileObservation,
  now: string,
): TrackingProfile {
  const fresh = ms(observation.at) >= ms(profile.lastSeenAt);
  const lastSeenAt = laterInstant(profile.lastSeenAt, observation.at);

  const pick = <T extends string | number>(
    current: T | undefined,
    observed: T | undefined,
  ): T | undefined => (fresh ? (observed ?? current) : (current ?? observed));

  const hashes: Record<string, string | undefined> = {};
  for (const key of PROFILE_HASH_KEYS) {
    hashes[key] = pick(profile.hashes[key], observation.hashes[key]);
  }

  const browser: Record<string, string | undefined> = {};
  for (const key of PROFILE_BROWSER_ID_KEYS) {
    browser[key] = pick(profile.browser[key], observation.browser[key]);
  }
  const observedFbc = observation.browser.fbc;
  const fbcAt = observation.browser.fbcCapturedAt ?? observation.at;
  const fbc = latest(
    { value: profile.browser.fbc, at: profile.browser.fbcCapturedAt ?? profile.createdAt },
    { value: observedFbc, at: fbcAt },
  );
  if (fbc !== undefined) {
    browser["fbc"] = fbc;
    browser["fbcCapturedAt"] =
      fbc === observedFbc ? fbcAt : (profile.browser.fbcCapturedAt ?? profile.createdAt);
  }

  const landing =
    observation.landing === undefined
      ? profile.landing
      : laterLanding(profile.landing, observation.landing);

  return compact({
    tenantId: profile.tenantId,
    visitorId: profile.visitorId,
    customerId: profile.customerId ?? observation.customerId,
    hashes: compact(hashes),
    clickIds: pruneClickIds(
      mergeProfileClickIds(profile.clickIds, observation.clickIds),
      lastSeenAt,
    ),
    browser: compact(browser),
    lastIp: pick(profile.lastIp, observation.ip),
    lastUserAgent: pick(profile.lastUserAgent, observation.userAgent),
    lastPageUrl: pick(profile.lastPageUrl, observation.pageUrl),
    lastSeenAt,
    geo: profile.geo,
    landing,
    botScore: profile.botScore,
    fingerprintId: profile.fingerprintId,
    leadIds: unionIds(profile.leadIds, observation.leadIds),
    orderIds: unionIds(profile.orderIds, observation.orderIds),
    version: profile.version,
    createdAt: profile.createdAt,
    updatedAt: now,
    expiresAt: expiresAtFor(lastSeenAt),
  });
}
