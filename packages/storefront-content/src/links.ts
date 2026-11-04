/**
 * The link rules both apps share (spec 2.2, Ruling 25): which URLs a menu item or a Morbeh-text
 * link may carry. Only `https:`, a single `mailto:` address, a `tel:` number, or (in rich text) a
 * path on this shop. Anything else is refused, and callers render the label as plain text.
 */

/** The longest URL or path a link may carry, before and after normalisation. */
export const LINK_URL_MAX = 2000;

// Whitespace, C0/C1 controls and no-break space; then zero-width, bidi and line-separator marks.
// eslint-disable-next-line no-control-regex -- rejecting these characters is the purpose
export const URL_CONTROLS = /[\u0000-\u0020\u007F-\u00A0]/;
export const URL_INVISIBLES = /[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/;

/** A storefront page handle: the `<handle>` of `/pages/<handle>` (spec GC3, preflight 15). */
export const PAGE_HANDLE_PATTERN = /^[a-z0-9_-]{1,100}$/;

const PAGE_PATH_PREFIX = "/pages/";

/** The handle of a storefront page path `/pages/<handle>`, or null for any other path. */
export function pageHandleOfPath(path: string): string | null {
  if (!path.startsWith(PAGE_PATH_PREFIX)) return null;
  const handle = path.slice(PAGE_PATH_PREFIX.length);
  return PAGE_HANDLE_PATTERN.test(handle) ? handle : null;
}

const MAILTO = /^mailto:([A-Za-z0-9.!#$%&'*+=^_{|}~-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/i;
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

function normalizeHttps(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
  if (url.hostname === "" || url.href.length > LINK_URL_MAX) return null;
  return url.href;
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
  let parsed: URL;
  try {
    parsed = new URL(raw, RELATIVE_BASE);
  } catch {
    return false;
  }
  return (
    parsed.origin === RELATIVE_BASE && `${parsed.pathname}${parsed.search}${parsed.hash}` === raw
  );
}

/** A link a page may render: a path on this shop, or an `https:` (external), `mailto:` or `tel:` URL. */
export function safeHref(
  raw: unknown,
): { readonly href: string; readonly external: boolean } | null {
  if (typeof raw === "string" && isSafeRelativePath(raw)) return { href: raw, external: false };
  const href = normalizeExternalUrl(raw);
  return href === null ? null : { href, external: href.startsWith("https:") };
}
