/** A base no real request uses: anything that resolves elsewhere left the shop. */
const BASE = "http://store.invalid";

/**
 * Spec 1.5: a relative path on this shop, otherwise `/`. The prefix checks catch the obvious
 * cases; the URL parse catches what a browser would do with the rest (it drops tab and newline, so
 * `/\t/evil.example` is `//evil.example`, preflight 17). The password page itself maps to `/`, so a
 * successful unlock never lands back on the form.
 */
export function safeReturnTo(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.startsWith("/\\")
  )
    return "/";
  let parsed: URL;
  try {
    parsed = new URL(raw, BASE);
  } catch {
    return "/";
  }
  if (parsed.origin !== BASE) return "/";
  if (parsed.pathname === "/password" || parsed.pathname.startsWith("/password/")) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
