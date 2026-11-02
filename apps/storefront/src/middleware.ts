import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, verifyAccessCookie } from "./lib/access-cookie";
import {
  createAccessReader,
  createPreviewChecker,
  fetchAccessFromRuntime,
  fetchPreviewValidity,
} from "./lib/access-cache";
import { LOCKED_REACHABLE_ROUTES, reachWhileLocked } from "./lib/locked-routes";
import { RETURN_PATH_HEADER, safeReturnTo, stripNextInternals } from "./lib/return-to";
import {
  PLATFORM_TENANT_ID,
  SHOP_ID_HEADER,
  createShopResolver,
  fetchShopFromRuntime,
  normalizeHost,
} from "./lib/shop-host";
import { storefrontSecrets } from "./lib/storefront-env";

const RUNTIME_API_URL = process.env.RUNTIME_API_URL ?? "http://localhost:3080";
const DEFAULT_SHOP_ID = process.env.TENANT_DEFAULT_ID ?? "tenant-local";
/** Same name as lib/online-store.ts PREVIEW_HEADER (redefined: middleware must stay Edge-light). */
const PREVIEW_HEADER = "x-morbeh-preview";
const PREVIEW_SHAPE = /^[A-Za-z0-9_-]{32,100}$/;

const resolveShop = createShopResolver({
  fetchShop: fetchShopFromRuntime(RUNTIME_API_URL, PLATFORM_TENANT_ID),
  now: () => Date.now(),
  ttlMs: 60_000,
});
const readAccess = createAccessReader({
  fetchAccess: fetchAccessFromRuntime(RUNTIME_API_URL),
  now: () => Date.now(),
  ttlMs: 15_000,
  staleMs: 5 * 60_000,
});
/** Review M-3: one Runtime call per token per 30 s at most; errors are never remembered. */
const previewIsValid = createPreviewChecker({
  check: fetchPreviewValidity(RUNTIME_API_URL),
  now: () => Date.now(),
  validTtlMs: 30_000,
  invalidTtlMs: 30_000,
  maxEntries: 500,
});

const text = (status: number, body: string) =>
  new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** Exactly `/password`: `/password/<x>` has no route, so it is gated like any other path. */
const isPasswordPage = (pathname: string) => pathname === "/password";
const isNextAsset = (pathname: string) => pathname.startsWith("/_next/");

/**
 * Framing and referrer rules. The k8s Ingress no longer sets X-Frame-Options or Referrer-Policy
 * (preflight 25), so this is their one owner: a preview may be framed by the admin and sends no
 * referrer; everything else is framed by the shop itself only.
 */
function framing(response: NextResponse, preview: boolean): NextResponse {
  if (preview) {
    const admin = storefrontSecrets().adminOrigin;
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set(
      "Content-Security-Policy",
      admin === null ? "frame-ancestors 'self'" : `frame-ancestors 'self' ${admin}`,
    );
  } else {
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  }
  return response;
}

/**
 * A refusal, a redirect to the gate, or the gate itself: never cached, never indexed (Decision 35).
 * Host refusals too (review M-6): a cached "Store not found" would outlive a newly connected domain.
 */
function gated(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex");
  return framing(response, false);
}

const unavailable = () => gated(text(503, "Temporarily unavailable / غير متاح مؤقتاً"));

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const headers = new Headers(request.headers);
  headers.delete(SHOP_ID_HEADER); // never trust a client-sent shop id
  headers.delete(PREVIEW_HEADER); // nor a client-sent preview token header
  // Where the visitor was, for the layout's second gate (review M-4): no token, no Next internals.
  const here = new URL(request.nextUrl);
  here.searchParams.delete("preview");
  stripNextInternals(here);
  const returnPath = safeReturnTo(`${here.pathname}${here.search}`);
  headers.set(RETURN_PATH_HEADER, returnPath);

  // 1. The shop (spec: the new steps run in both modes; routing off ⇒ the deployment shop).
  let shopId = DEFAULT_SHOP_ID;
  if (process.env.STOREFRONT_HOST_ROUTING === "on") {
    const host = normalizeHost(request.headers.get("host"));
    if (host === null) return gated(text(400, "Bad request"));
    let shop;
    try {
      shop = await resolveShop(host);
    } catch {
      return unavailable();
    }
    if (shop === null) return gated(text(404, "Store not found / المتجر غير موجود"));
    if (shop.shopStatus !== "active")
      return gated(text(503, "This store is unavailable / هذا المتجر غير متاح"));
    headers.set(SHOP_ID_HEADER, shop.shopId);
    shopId = shop.shopId;
  }

  // 2. Preview is view-only: every non-read request that carries ?preview= is refused (Ruling 15).
  const isRead = request.method === "GET" || request.method === "HEAD";
  const previewParam = request.nextUrl.searchParams.get("preview");
  if (previewParam !== null && !isRead)
    return gated(text(403, "Not available in preview / غير متاح أثناء المعاينة"));
  // A malformed value is ignored: never forwarded, never sent to the Runtime.
  const token =
    isRead && previewParam !== null && PREVIEW_SHAPE.test(previewParam) ? previewParam : null;
  const pass = (forwardToken: string | null) => {
    if (forwardToken !== null) headers.set(PREVIEW_HEADER, forwardToken);
    return framing(NextResponse.next({ request: { headers } }), forwardToken !== null);
  };

  // 3. The gate itself. Opening it while unlocked reads the SAME cache as the gate (preflight 21), so
  // the page and the gate never disagree; an unknown state just shows the form.
  const { pathname } = request.nextUrl;
  if (isPasswordPage(pathname)) {
    if (isRead) {
      try {
        if (!(await readAccess(shopId)).locked) {
          const back = safeReturnTo(request.nextUrl.searchParams.get("return_to"));
          return gated(NextResponse.redirect(new URL(back, request.url), 302));
        }
      } catch {
        // Render the form: the unlock itself asks the Runtime.
      }
    }
    return gated(NextResponse.next({ request: { headers } }));
  }
  // Next's own assets (outside the matcher anyway): never a token, never a write.
  if (isNextAsset(pathname) && isRead) return pass(null);

  // 4. The lock gate.
  let state;
  try {
    state = await readAccess(shopId);
  } catch {
    return unavailable(); // fail closed
  }
  if (!state.locked) return pass(token); // the layout validates the token before any draft shows

  // Ruling 36: on a locked store a token opens the door only once the Runtime calls it a preview.
  if (token !== null && (await previewIsValid(shopId, token))) return pass(token);
  const unlocked = await verifyAccessCookie(request.cookies.get(ACCESS_COOKIE)?.value, {
    secret: storefrontSecrets().accessSecret,
    shopId,
    accessVersion: state.accessVersion,
    nowUnix: Math.floor(Date.now() / 1000),
  });
  // A cookie holder with a token the Runtime refused is an ordinary visit: the token is not forwarded.
  if (unlocked) return pass(null);
  // Decision 34: a route that exists and stays public while locked, for reads only (review M-1, M-2).
  const reach = reachWhileLocked(pathname, request.method, LOCKED_REACHABLE_ROUTES);
  if (reach === "reachable") return pass(null);
  if (reach === "forbidden" || !isRead) return gated(text(403, "Forbidden / غير مسموح"));
  const target = new URL("/password", request.url);
  target.searchParams.set("return_to", returnPath);
  return gated(NextResponse.redirect(target, 302));
}

export const config = {
  // Static assets, Caddy's TLS "ask" endpoint, the revalidation hook and the health probe never need
  // a shop. Anchored, so a look-alike path (`/api/healthzx`) stays behind the gate (preflight 24, 27).
  matcher: [
    "/((?!_next/|favicon\\.ico$|api/tls-allowed(?:/|$)|api/revalidate(?:/|$)|api/healthz(?:/|$)).*)",
  ],
};
