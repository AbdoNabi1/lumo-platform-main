/**
 * H-01 (audit): `RETURN_TO_COOKIE` is written by `middleware.ts` from the ORIGINAL request's own
 * path+search — normally safe — but a cookie is still attacker-writable in general (a sibling
 * subdomain sharing `COOKIE_DOMAIN` in production, or any XSS elsewhere that can `document.cookie`
 * before this one's `httpOnly` was set). `new URL(rawValue, origin)` on an unvalidated absolute URL
 * (`https://evil.com`) or a protocol-relative one (`//evil.com`) redirects off-site straight after
 * a successful login — the classic post-auth open-redirect shape. Only a same-origin, root-relative
 * path is accepted; anything else (including a parse failure) falls back to `/`.
 *
 * A standalone module, not exported from `auth/callback/route.ts` itself — Next.js's App Router
 * only permits a fixed set of named exports (GET/POST/config/…) from a `route.ts` file; anything
 * else fails typegen against `.next/types/app/**\/route.ts`.
 */
export function safeReturnTo(raw: string | undefined, origin: string): string {
  if (raw === undefined || !raw.startsWith("/")) return "/";
  // `//host/...` (protocol-relative) and `/\host/...` (browsers normalize the backslash to `/`,
  // the same trick with different spelling) both parse as absolute URLs to a different host.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  try {
    return new URL(raw, origin).origin === origin ? raw : "/";
  } catch {
    return "/";
  }
}
