/**
 * Normalization stage (directive §Transformation Pipeline; doc 16 §Advanced matching).
 *
 * Every conversions API expects identity fields in one canonical form, and every one of them
 * rejects — or silently mis-matches — values that differ only by case, punctuation or spacing.
 * Normalizing **once, here**, is what makes Event Match Quality reproducible: a destination mapper
 * never re-normalizes, it only hashes and renames.
 *
 * Ordering matters and is non-negotiable: **normalize before hashing**. A SHA-256 of
 * `"  Ali@Example.COM "` and of `"ali@example.com"` share no bits, so hashing first would destroy
 * every match while still looking correct on the wire.
 */

import type { IdentityContext } from "../envelope/identity-context";

/** Trims and collapses internal whitespace; returns undefined for anything empty. */
function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed === "" ? undefined : trimmed;
}

/** Lowercased, trimmed. Sub-addressing and dots are **preserved** — platforms match verbatim. */
export function normalizeEmail(email: string | undefined): string | undefined {
  const cleaned = clean(email)?.toLowerCase();
  if (cleaned === undefined) return undefined;
  // A value without a single `@` cannot match anywhere; drop it rather than forward noise.
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleaned) ? cleaned : undefined;
}

/** Maps Arabic-Indic (U+0660–U+0669) and Persian (U+06F0–U+06F9) digits to `0-9`; leaves everything else. */
export function toLatinDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Valid national-number lengths (digits after the country code) for the markets we serve:
 * EG landline 9 / mobile 10, SA 9, UAE landline 8 / mobile 9.
 */
export const NATIONAL_NUMBER_LENGTHS: Readonly<Record<string, readonly number[]>> = {
  "20": [9, 10],
  "966": [9],
  "971": [8, 9],
};

/** International form: digits only, no leading `0`, 8–15 digits long. */
function internationalFromDigits(digits: string): string | undefined {
  if (digits === "" || digits.startsWith("0")) return undefined;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
}

/**
 * E.164: a leading `+` followed by country code and subscriber number, no separators.
 *
 * A national number cannot be normalized without knowing its country, so `defaultCountryCode` must
 * be supplied to upgrade one. Without it a national number is **dropped rather than guessed** — a
 * wrong country code produces a confident match against the wrong person.
 *
 * Arabic and Persian digits are converted first. A number that already carries its country code
 * (`201012345678`, `00201012345678`) is never given it twice.
 */
export function normalizePhone(
  phone: string | undefined,
  defaultCountryCode?: string,
): string | undefined {
  const cleaned = clean(phone);
  if (cleaned === undefined) return undefined;

  const latin = toLatinDigits(cleaned);
  const digits = latin.replace(/\D/g, "");

  if (latin.startsWith("+")) return internationalFromDigits(digits);
  if (digits.startsWith("00")) return internationalFromDigits(digits.slice(2));

  const cc =
    defaultCountryCode === undefined ? "" : toLatinDigits(defaultCountryCode).replace(/\D/g, "");
  if (cc === "" || cc.startsWith("0")) return undefined;
  if (digits === "") return undefined;

  const lengths = NATIONAL_NUMBER_LENGTHS[cc];
  if (
    lengths !== undefined &&
    digits.startsWith(cc) &&
    lengths.includes(digits.length - cc.length)
  ) {
    return `+${digits}`;
  }

  // Strip a national trunk prefix ("0") before prepending the country code.
  const national = digits.replace(/^0+/, "");
  if (national === "") return undefined;
  if (lengths !== undefined) {
    if (!lengths.includes(national.length)) return undefined;
  } else {
    const total = cc.length + national.length;
    if (total < 8 || total > 15) return undefined;
  }
  return `+${cc}${national}`;
}

/**
 * Lowercase, punctuation and spacing removed — the form Meta/TikTok/Snap all specify. The Arabic
 * tatweel (U+0640, a letter-modifier that survives `\p{L}`) is removed; diacritics are marks and
 * already fall to the punctuation rule.
 */
export function normalizeName(name: string | undefined): string | undefined {
  const cleaned = clean(name)
    ?.toLowerCase()
    .replace(/\u0640/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return cleaned === undefined || cleaned === "" ? undefined : cleaned;
}

/** Lowercase, spacing and punctuation removed (`"New  York!"` → `"newyork"`). */
export function normalizeCity(city: string | undefined): string | undefined {
  return normalizeName(city);
}

/** Lowercased ISO-3166-1 alpha-2. Anything that is not two letters is dropped. */
export function normalizeCountry(country: string | undefined): string | undefined {
  const cleaned = clean(country)
    ?.toLowerCase()
    .replace(/[^a-z]/g, "");
  return cleaned !== undefined && cleaned.length === 2 ? cleaned : undefined;
}

/** Lowercased region code, punctuation removed. */
export function normalizeState(state: string | undefined): string | undefined {
  return normalizeName(state);
}

/**
 * Lowercased, spacing removed. For US ZIP+4 only the leading five digits are kept, which is what
 * the platforms match on; other postal systems are passed through cleaned.
 */
export function normalizePostalCode(
  postalCode: string | undefined,
  country?: string,
): string | undefined {
  const cleaned = clean(postalCode)?.toLowerCase().replace(/\s/g, "");
  if (cleaned === undefined) return undefined;

  if (normalizeCountry(country) === "us") {
    const digits = cleaned.replace(/\D/g, "");
    return digits.length >= 5 ? digits.slice(0, 5) : undefined;
  }
  return cleaned;
}

/** Single-letter gender (`m`/`f`); anything else is dropped rather than guessed. */
export function normalizeGender(gender: string | undefined): string | undefined {
  const cleaned = clean(gender)?.toLowerCase();
  if (cleaned === undefined) return undefined;
  if (cleaned.startsWith("m")) return "m";
  if (cleaned.startsWith("f")) return "f";
  return undefined;
}

/** `YYYYMMDD`, the form every conversions API expects. Accepts ISO or already-compact input. */
export function normalizeBirthDate(birthDate: string | undefined): string | undefined {
  const cleaned = clean(birthDate);
  if (cleaned === undefined) return undefined;

  const digits = cleaned.replace(/\D/g, "");
  if (digits.length !== 8) return undefined;

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  return digits;
}

/**
 * Normalizes every matchable field on an identity block. Fields that cannot be canonicalized are
 * **omitted rather than passed through dirty** — an unmatched field costs one signal, a wrongly
 * normalized one corrupts attribution for a real person.
 *
 * `hashStatus` is asserted as `raw`: this is the internal, pre-hash form. The hashing stage flips
 * it, so a double-hash is detectable rather than silent.
 */
export function normalizeIdentity(
  identity: IdentityContext,
  options: { readonly defaultCountryCode?: string } = {},
): IdentityContext {
  const country = normalizeCountry(identity.country);

  const normalized: Record<string, unknown> = {
    ...identity,
    email: normalizeEmail(identity.email),
    phone: normalizePhone(identity.phone, options.defaultCountryCode),
    firstName: normalizeName(identity.firstName),
    lastName: normalizeName(identity.lastName),
    city: normalizeCity(identity.city),
    state: normalizeState(identity.state),
    country,
    postalCode: normalizePostalCode(identity.postalCode, identity.country),
    gender: normalizeGender(identity.gender),
    birthDate: normalizeBirthDate(identity.birthDate),
    hashStatus: "raw",
  };

  for (const key of Object.keys(normalized)) {
    if (normalized[key] === undefined) delete normalized[key];
  }

  return normalized;
}
