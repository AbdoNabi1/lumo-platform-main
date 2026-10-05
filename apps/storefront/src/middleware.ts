import { NextResponse, type NextRequest } from "next/server";
import {
  SHOP_ID_HEADER,
  createShopResolver,
  fetchShopFromRuntime,
  normalizeHost,
} from "./lib/shop-host";

const RUNTIME_API_URL = process.env.RUNTIME_API_URL ?? "http://localhost:3080";
const PLATFORM_TENANT_ID =
  process.env.PLATFORM_TENANT_ID ?? process.env.TENANT_DEFAULT_ID ?? "tenant-local";

const resolveShop = createShopResolver({
  fetchShop: fetchShopFromRuntime(RUNTIME_API_URL, PLATFORM_TENANT_ID),
  now: () => Date.now(),
  ttlMs: 60_000,
});

const page = (status: number, text: string) =>
  new NextResponse(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const headers = new Headers(request.headers);
  headers.delete(SHOP_ID_HEADER); // never trust a client-sent shop id
  if (process.env.STOREFRONT_HOST_ROUTING !== "on") {
    return NextResponse.next({ request: { headers } });
  }
  const host = normalizeHost(request.headers.get("host"));
  if (host === null) return page(400, "Bad request");
  let shop;
  try {
    shop = await resolveShop(host);
  } catch {
    return page(503, "Temporarily unavailable / غير متاح مؤقتاً");
  }
  if (shop === null) return page(404, "Store not found / المتجر غير موجود");
  if (shop.shopStatus !== "active")
    return page(503, "This store is unavailable / هذا المتجر غير متاح");
  headers.set(SHOP_ID_HEADER, shop.shopId);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static assets and Caddy's TLS "ask" endpoint never need a shop.
  matcher: ["/((?!_next/|favicon\\.ico|api/tls-allowed).*)"],
};
