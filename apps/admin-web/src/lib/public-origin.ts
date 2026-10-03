/**
 * The origin the BROWSER used to reach admin-web — the one a `redirect_uri` and a redirect must name.
 * Edge-safe (no `node:*` imports): `middleware.ts` runs on the Edge runtime and needs this too.
 *
 * Why `request.nextUrl.origin` is not used: a Next standalone server builds it from the address it
 * bound to, not from the request. Measured against this app's own build with `PORT=8080
 * HOSTNAME=127.0.0.1` and a correct `Host`/`X-Forwarded-*`: the authorize redirect carried
 * `redirect_uri=https://localhost:8080/auth/callback`. On Railway that is the container's own name,
 * so the OAuth2 round trip could never complete.
 *
 * Order: `ADMIN_WEB_ORIGIN` when set (an operator-pinned value, nothing taken from the request) →
 * `x-forwarded-host`/`host` + `x-forwarded-proto` → `nextUrl.origin` (only when the request carries
 * no usable host). A host that is not a plain `name[:port]` is ignored rather than trusted. Ory
 * validates `redirect_uri` against the registered client, so a forged Host cannot turn this into an
 * open redirect to another site; pinning `ADMIN_WEB_ORIGIN` removes even that dependency.
 */
interface OriginSource {
  readonly headers: Headers;
  readonly nextUrl: { readonly origin: string };
}

const PLAIN_HOST = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

function firstValue(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first === undefined || first.length === 0 ? undefined : first;
}

export function publicOrigin(request: OriginSource): string {
  const pinned = process.env["ADMIN_WEB_ORIGIN"]?.trim();
  if (pinned !== undefined && pinned.length > 0) return pinned.replace(/\/+$/, "");

  const host =
    firstValue(request.headers.get("x-forwarded-host")) ?? firstValue(request.headers.get("host"));
  if (host === undefined || !PLAIN_HOST.test(host)) return request.nextUrl.origin;

  const forwarded = firstValue(request.headers.get("x-forwarded-proto"))?.toLowerCase();
  const proto =
    forwarded === "http" || forwarded === "https"
      ? forwarded
      : host.startsWith("localhost")
        ? "http"
        : "https";
  return `${proto}://${host}`;
}
