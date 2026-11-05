/**
 * The link rules both apps share (spec 2.2, Ruling 25): which URLs a menu item or a Morbeh-text
 * link may carry. Only `https:`, a single `mailto:` address, a `tel:` number, or (in rich text) a
 * path on this shop. Anything else is refused, and callers render the label as plain text.
 */

/** The longest URL or path a link may carry, before and after normalisation. */
export const LINK_URL_MAX = 2000;

// Whitespace, C0/C1 controls and no-break space; then soft hyphen, Arabic letter mark,
// zero-width, bidi, word-joiner and line-separator marks.
// eslint-disable-next-line no-control-regex -- rejecting these characters is the purpose
export const URL_CONTROLS = /[\u0000-\u0020\u007F-\u00A0]/;
export const URL_INVISIBLES =
  /[\u00AD\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

/** A storefront page handle: the `<handle>` of `/pages/<handle>` (spec GC3, preflight 15). */
export const PAGE_HANDLE_PATTERN = /^[a-z0-9_-]{1,100}$/;

const PAGE_PATH_PREFIX = "/pages/";

/** The handle of a storefront page path `/pages/<handle>`, or null for any other path. */
export function pageHandleOfPath(path: string): string | null {
  if (!path.startsWith(PAGE_PATH_PREFIX)) return null;
  const handle = path.slice(PAGE_PATH_PREFIX.length);
  return PAGE_HANDLE_PATTERN.test(handle) ? handle : null;
}

// No `%` in the local part (review M2): an encoded `?`, `,` or newline could become a query or a
// second address in a client that decodes before splitting.
const MAILTO = /^mailto:([A-Za-z0-9.!#$&'*+=^_{|}~-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/i;
const TEL = /^tel:(\+?)([0-9 ().-]+)$/i;
const TEL_DIGITS_MIN = 3;
const TEL_DIGITS_MAX = 20;

function hasHiddenCharacter(value: string): boolean {
  return URL_CONTROLS.test(value) || URL_INVISIBLES.test(value);
}

/**
 * An `https:`, `mailto:` or `tel:` URL in its stored form, or null. `https:` is the parsed
 * `URL.href` (no credentials); `mailto:` is exactly one address with no query, its domain in lower
 * case; `tel:` is an optional `+` and 3 to 20 digits. Any control, whitespace, zero-width or bidi
 * character refuses the URL; inside a `tel:` number the ASCII space alone is allowed (preflight 5).
 */
export function normalizeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > LINK_URL_MAX) return null;
  const scheme = raw.slice(0, 8).toLowerCase();
  if (scheme.startsWith("tel:")) {
    if (hasHiddenCharacter(raw.replace(/ /g, ""))) return null;
    const match = TEL.exec(raw);
    if (!match) return null;
    const digits = (match[2] ?? "").replace(/[^0-9]/g, "");
    if (digits.length < TEL_DIGITS_MIN || digits.length > TEL_DIGITS_MAX) return null;
    return `tel:${match[1] ?? ""}${digits}`;
  }
  if (hasHiddenCharacter(raw)) return null;
  if (scheme === "https://") return normalizeHttps(raw);
  if (scheme.startsWith("mailto:")) {
    const match = MAILTO.exec(raw);
    if (!match) return null;
    return `mailto:${match[1] ?? ""}@${(match[2] ?? "").toLowerCase()}`;
  }
  return null;
}

function parseUrl(raw: string, base?: string): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

/**
 * The parsed `href`, which must itself parse back to the same `href` (review M1): some IDN hosts
 * normalise to a punycode form the parser then refuses, and a stored or rendered value must pass
 * these same rules again.
 */
function normalizeHttps(raw: string): string | null {
  const url = parseUrl(raw);
  if (url === null || url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname === "" || url.href.length > LINK_URL_MAX) return null;
  return parseUrl(url.href)?.href === url.href ? url.href : null;
}

/** A base no real request uses: a path that resolves anywhere else leaves the shop. */
const RELATIVE_BASE = "http://store.invalid";
/** One `/`, then neither `/` nor `\`; no whitespace or backslash anywhere. */
const RELATIVE_SHAPE = /^\/(?![/\\])[^\s\\]*$/;

/**
 * A path on this shop: one leading `/`, never `//` or `/\`, no whitespace, backslash, control or
 * invisible character, at most `LINK_URL_MAX` long. As in Part 1's `safeReturnTo` (review C-1,
 * preflight 3), the parse must keep the shop's origin and give back exactly the same path, so dot
 * segments (`/.//evil.example`, `/%2e//evil.example`) can never rebuild a `//host`.
 */
export function isSafeRelativePath(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > LINK_URL_MAX) return false;
  if (!RELATIVE_SHAPE.test(raw) || hasHiddenCharacter(raw)) return false;
  return resolvedPath(raw) === raw;
}

/** `pathname+search+hash` of `raw` resolved on the shop's origin, or null when it leaves it. */
function resolvedPath(raw: string): string | null {
  const parsed = parseUrl(raw, RELATIVE_BASE);
  if (parsed === null || parsed.origin !== RELATIVE_BASE) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * A same-site path in its canonical, percent-encoded form (review M6): `/search?q=<Arabic>` and
 * `/pages/<Arabic>` are encoded, and a bare trailing `?` or `#` is dropped. The input must have
 * the safe shape and no hidden character, and the OUTPUT must pass `isSafeRelativePath` (one `/`,
 * same origin, exact round-trip), so a dot segment that rebuilds `//host` is still refused.
 */
function canonicalRelativePath(raw: string): string | null {
  if (raw.length > LINK_URL_MAX) return null;
  if (!RELATIVE_SHAPE.test(raw) || hasHiddenCharacter(raw)) return null;
  const canonical = resolvedPath(raw);
  return canonical !== null && isSafeRelativePath(canonical) ? canonical : null;
}

type SafeHref = { readonly href: string; readonly external: boolean };

function safeHrefOnce(raw: unknown): SafeHref | null {
  if (typeof raw === "string") {
    const path = canonicalRelativePath(raw);
    if (path !== null) return { href: path, external: false };
  }
  const href = normalizeExternalUrl(raw);
  return href === null ? null : { href, external: href.startsWith("https:") };
}

/**
 * A link a page may render: a canonical path on this shop, or an `https:` (external), `mailto:`
 * or `tel:` URL. The result is a fixed point (`safeHref(result.href)` gives it back), so the
 * validator, the stored value and the renderer's re-check always agree.
 */
export function safeHref(raw: unknown): SafeHref | null {
  const first = safeHrefOnce(raw);
  if (first === null) return null;
  const again = safeHrefOnce(first.href);
  return again !== null && again.href === first.href && again.external === first.external
    ? first
    : null;
}
