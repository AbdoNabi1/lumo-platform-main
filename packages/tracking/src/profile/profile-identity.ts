/**
 * Moves identity in and out of a profile (Tracking P1-D4): raw identity on an event → the profile's hash sets,
 * and a profile's hash sets → the per-platform match keys a delivery can use.
 *
 * Both directions go through the SAME rules the delivery already uses (`normalizeIdentity`,
 * `platformMatchKeys`), never a second copy of them: a hash the profile stored on Tuesday must be byte-identical
 * to the one a delivery would have computed from the same email on Friday, or the match is silently lost.
 * The profile's hash sets are read straight off the five platform key sets:
 *
 * | profile slot            | taken from                         | used for                 |
 * |-------------------------|------------------------------------|--------------------------|
 * | `emailStd`              | meta `em`                          | meta, snap, tiktok `em`  |
 * | `emailGads`             | google_ads `em` (gmail rules)      | google_ads `em`          |
 * | `emailGa4`              | ga4 `em` (gmail dots only)         | ga4 `em`                 |
 * | `phoneDigits`           | meta `ph` (no `+`)                 | meta, snap `ph`          |
 * | `phoneE164`             | tiktok `ph` (`+` kept)             | tiktok, google_ads, ga4  |
 * | `fn` `ln` `ct` `st` `country` `externalId` | meta (hashed)   | meta, snap (tiktok: fn, ln, externalId) |
 *
 * City, state and country are PLAIN for TikTok, Google Ads and GA4 and a profile holds hashes only, so those
 * three platforms get no address block from a profile — they take it from the event itself, as before.
 */

import type { IdentityContext } from "../envelope/identity-context";
import type { HashPort } from "../ids/dedup-id";
import { normalizeIdentity } from "../pipeline/normalization";
import {
  platformMatchKeys,
  type MatchPlatform,
  type PlatformMatchKeys,
} from "../pipeline/platform-identity";
import type { ProfileHashes } from "./tracking-profile";

function compact<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as T;
}

/**
 * The hash sets of a raw identity block. An identity that is already hashed (`hashStatus` other than `raw`) has
 * nothing to re-derive per platform from a digest, so it yields no hashes — exactly as in delivery.
 */
export async function deriveProfileHashes(
  identity: IdentityContext | undefined,
  hasher: HashPort,
  defaultCountryCode?: string,
): Promise<ProfileHashes> {
  if (identity === undefined || identity.hashStatus !== "raw") return {};

  const normalized = normalizeIdentity(
    identity,
    defaultCountryCode === undefined ? {} : { defaultCountryCode },
  );
  const [meta, tiktok, googleAds, ga4] = await Promise.all([
    platformMatchKeys("meta", normalized, hasher),
    platformMatchKeys("tiktok", normalized, hasher),
    platformMatchKeys("google_ads", normalized, hasher),
    platformMatchKeys("ga4", normalized, hasher),
  ]);

  return compact({
    emailStd: meta.em,
    emailGads: googleAds.em,
    emailGa4: ga4.em,
    phoneDigits: meta.ph,
    phoneE164: tiktok.ph,
    fn: meta.fn,
    ln: meta.ln,
    ct: meta.ct,
    st: meta.st,
    country: meta.country,
    externalId: meta.externalId,
  });
}

export type ProfileMatchKeys = Readonly<Record<MatchPlatform, PlatformMatchKeys>>;

/** The match keys each platform can be given from a profile's hashes alone (see the table above). */
export function profileMatchKeys(hashes: ProfileHashes): ProfileMatchKeys {
  const hashedAddress = compact({
    fn: hashes.fn,
    ln: hashes.ln,
    ct: hashes.ct,
    st: hashes.st,
    country: hashes.country,
  });
  return {
    meta: compact({
      em: hashes.emailStd,
      ph: hashes.phoneDigits,
      ...hashedAddress,
      externalId: hashes.externalId,
    }),
    snap: compact({
      em: hashes.emailStd,
      ph: hashes.phoneDigits,
      ...hashedAddress,
      externalId: hashes.externalId,
    }),
    tiktok: compact({
      em: hashes.emailStd,
      ph: hashes.phoneE164,
      fn: hashes.fn,
      ln: hashes.ln,
      externalId: hashes.externalId,
    }),
    google_ads: compact({ em: hashes.emailGads, ph: hashes.phoneE164 }),
    ga4: compact({ em: hashes.emailGa4, ph: hashes.phoneE164 }),
  };
}

/**
 * Fills a platform's keys with what the profile knows. The event's own keys always win: the profile completes
 * an event, it never contradicts what the event itself asserted.
 */
export function withProfileKeys(
  own: PlatformMatchKeys,
  fromProfile: PlatformMatchKeys | undefined,
): PlatformMatchKeys {
  return fromProfile === undefined ? own : { ...fromProfile, ...own };
}
