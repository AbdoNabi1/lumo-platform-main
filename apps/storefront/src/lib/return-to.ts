/** A base no real request uses: anything that resolves elsewhere left the shop. */
const BASE = "http://store.invalid";

/**
 * Set ONLY by middleware (a client-sent copy is replaced): the page the visitor asked for, so the
 * layout's second gate can send them back after unlocking (review M-4).
 */
export const RETURN_PATH_HEADER = "x-morbeh-return-path";

/** One `/`, then neither `/` nor `\` (or nothing): a path on this host, never `//host`. */
const SAFE_SHAPE = /^\/(?:$|[^/\\])/;

/** Next's own request parameters (`_rsc`, `__nextDataReq`, …) never belong in a return address. */
export function stripNextInternals(url: URL): void {
  const internal = [...url.searchParams.keys()].filter(
    (name) => name === "_rsc" || name.startsWith("__next"),
  );
  for (const name of new Set(internal)) url.searchParams.delete(name);
}

/**
 * Spec 1.5: a relative path on this shop, otherwise `/`. The OUTPUT is what is checked (review
 * C-1): parsing resolves dot segments and drops tab and newline, so `/.//evil.example` or
 * `/\t/evil.example` would otherwise come out as `//evil.example`. The result must have the safe
 * shape and resolve, against this origin, to exactly itself. The password page maps to `/`, so a
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
  stripNextInternals(parsed);
  const result = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return isSafeResult(result) ? result : "/";
}

function isSafeResult(result: string): boolean {
  if (!SAFE_SHAPE.test(result)) return false;
  let again: URL;
  try {
    again = new URL(result, BASE);
  } catch {
    return false;
  }
  return again.origin === BASE && `${again.pathname}${again.search}${again.hash}` === result;
}
