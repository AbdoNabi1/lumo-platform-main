/**
 * Per-platform match keys (lead-site plan B, Task 2).
 *
 * `hashIdentity` hashes every field the same way; the ad platforms do not want the same form.
 * Meta/Snap hash everything (phone without `+`), TikTok keeps city/state/country plain, Google Ads
 * wants gmail addresses canonicalized and a plain address block that is sent only when complete,
 * and GA4 wants digits removed from names. This module returns, per platform, the final value of
 * each key: a SHA-256 hex digest or a plain value.
 *
 * Input contract: the identity is the output of `normalizeIdentity` (`hashStatus: "raw"`). Callers
 * must check `hashStatus` BEFORE calling `normalizeIdentity`, because it sets `raw` on whatever it
 * is given — an already-hashed block would otherwise be normalized and hashed a second time.
 * Anything not `raw` here throws `DoubleHashError`.
 *
 * A value that is empty after per-platform formatting is omitted, never hashed: `sha256("")` is a
 * valid-looking digest shared by every empty value and poisons matching.
 *
 * Never hashed anywhere: IP, user agent, fbp, fbc, ttclid, ttp, sc_click_id, sc_cookie1, gclid,
 * gbraid, wbraid — they are not part of this module at all.
 */

import type { IdentityContext } from "../envelope/identity-context";
import type { HashPort } from "../ids/dedup-id";
import { DoubleHashError } from "./hashing";

export type MatchPlatform = "meta" | "snap" | "tiktok" | "google_ads" | "ga4";

export interface PlatformMatchKeys {
  // every value is final: a hash or a plain value, per the platform table
  readonly em?: string;
  readonly ph?: string;
  readonly fn?: string;
  readonly ln?: string;
  readonly ct?: string;
  readonly st?: string;
  readonly zp?: string;
  readonly country?: string;
  readonly externalId?: string;
}

const GMAIL_DOMAINS: ReadonlySet<string> = new Set(["gmail.com", "googlemail.com"]);

/** Collapses whitespace; first token is the first name, the rest (one space) the last name. */
export function splitFullName(full: string | undefined): {
  readonly firstName?: string;
  readonly lastName?: string;
} {
  const tokens = (full ?? "").split(/\s+/u).filter((token) => token !== "");
  const [firstName, ...rest] = tokens;
  return {
    ...(firstName !== undefined ? { firstName } : {}),
    ...(rest.length > 0 ? { lastName: rest.join(" ") } : {}),
  };
}

/**
 * Google Ads: gmail/googlemail lose every `.` and the first `+` with everything after it in the
 * local part. GA4: same domains, dots only. Everything else is returned unchanged.
 *
 * The result can have an empty local part (`+one@gmail.com` for Google Ads, `...@gmail.com` for
 * either) and then reads `@gmail.com`. That string is returned as-is; `platformMatchKeys` guards
 * it and never hashes it.
 */
export function emailForPlatform(email: string, platform: MatchPlatform): string {
  if (platform !== "google_ads" && platform !== "ga4") return email;

  const at = email.lastIndexOf("@");
  if (at < 0) return email;
  const domain = email.slice(at + 1).toLowerCase();
  if (!GMAIL_DOMAINS.has(domain)) return email;

  let local = email.slice(0, at);
  if (platform === "google_ads") {
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
  }
  return `${local.replace(/\./gu, "")}@${email.slice(at + 1)}`;
}

/** Meta and Snap take digits only (no `+`); every other platform keeps `+<digits>`. */
export function phoneForPlatform(e164: string, platform: MatchPlatform): string {
  return platform === "meta" || platform === "snap" ? e164.replace(/^\+/u, "") : e164;
}

/** A string with content, else undefined — the single "is this empty" rule. */
function present(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

export async function platformMatchKeys(
  platform: MatchPlatform,
  identity: IdentityContext,
  hasher: HashPort,
): Promise<PlatformMatchKeys> {
  if (identity.hashStatus !== "raw") {
    throw new DoubleHashError(identity.hashStatus ?? "mixed");
  }

  const isGoogleAds = platform === "google_ads";
  const isGa4 = platform === "ga4";
  const isTikTok = platform === "tiktok";

  const email = present(identity.email);
  const phone = present(identity.phone);
  const stripDigits = (name: string | undefined): string | undefined =>
    present(isGa4 ? name?.replace(/\p{N}/gu, "") : name);
  const firstName = stripDigits(identity.firstName);
  const lastName = stripDigits(identity.lastName);
  const city = present(identity.city);
  const state = present(identity.state);
  const postalCode = present(identity.postalCode);
  const country = present(identity.country);
  const externalId = present(identity.externalId?.trim());

  // Google Ads accepts an address block only when it is complete ([20]); otherwise only em/ph.
  const addressAllowed =
    !isGoogleAds ||
    (firstName !== undefined &&
      lastName !== undefined &&
      country !== undefined &&
      postalCode !== undefined);

  const hash = (value: string): Promise<string> => hasher.sha256Hex(value);
  const keys: { -readonly [K in keyof PlatformMatchKeys]: PlatformMatchKeys[K] } = {};

  if (email !== undefined) {
    // `emailForPlatform` can leave a domain-only string (`@gmail.com`) that every such visitor
    // would share; with no local part there is nothing to match on, so omit `em`.
    const formatted = emailForPlatform(email, platform);
    if (formatted.slice(0, formatted.lastIndexOf("@")) !== "") keys.em = await hash(formatted);
  }
  if (phone !== undefined) keys.ph = await hash(phoneForPlatform(phone, platform));

  if (addressAllowed) {
    if (firstName !== undefined) keys.fn = await hash(firstName);
    if (lastName !== undefined) keys.ln = await hash(lastName);

    if (city !== undefined) keys.ct = isTikTok || isGoogleAds || isGa4 ? city : await hash(city);
    if (state !== undefined) keys.st = isTikTok || isGoogleAds || isGa4 ? state : await hash(state);

    if (postalCode !== undefined) {
      keys.zp = isGoogleAds || isGa4 ? postalCode : await hash(postalCode);
    }

    if (country !== undefined) {
      if (isGoogleAds || isGa4) keys.country = country.toUpperCase();
      else if (isTikTok) keys.country = country;
      else keys.country = await hash(country);
    }
  }

  if (externalId !== undefined && !isGoogleAds && !isGa4) {
    keys.externalId = await hash(externalId);
  }

  return keys;
}
