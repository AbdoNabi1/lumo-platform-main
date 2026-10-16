import { PLATFORM_TENANT_ID, fetchShopFromRuntime, normalizeHost } from "@/lib/shop-host";

const RUNTIME_API_URL = process.env.RUNTIME_API_URL ?? "http://localhost:3080";

/**
 * Plan 1A: Caddy's on-demand TLS "ask" endpoint (`GET /api/tls-allowed?domain=x`). 200 ⇒ Caddy may
 * obtain a certificate for `x`; anything else ⇒ it must not. Only verified domains of non-cancelled
 * shops qualify, so nobody can make the platform request certificates for arbitrary names.
 */
export async function GET(request: Request): Promise<Response> {
  const host = normalizeHost(new URL(request.url).searchParams.get("domain"));
  if (host === null) return new Response(null, { status: 400 });
  try {
    const shop = await fetchShopFromRuntime(RUNTIME_API_URL, PLATFORM_TENANT_ID)(host);
    return new Response(null, {
      status: shop !== null && shop.shopStatus !== "cancelled" ? 200 : 404,
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
