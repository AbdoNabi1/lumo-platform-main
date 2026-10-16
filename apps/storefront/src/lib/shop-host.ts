/** Plan 1A: Host → shop resolution for the storefront edge. Pure, so it is testable without Next. */

export const SHOP_ID_HEADER = "x-shop-id";

/** The PLATFORM tenant scope the public domain-resolve call addresses; read here and nowhere else. */
export const PLATFORM_TENANT_ID =
  process.env.PLATFORM_TENANT_ID ?? process.env.TENANT_DEFAULT_ID ?? "tenant-local";

export interface ResolvedShop {
  readonly shopId: string;
  readonly hostname: string;
  readonly primaryHostname: string;
  readonly shopStatus: "active" | "suspended" | "cancelled";
}

export function normalizeHost(rawHost: string | null): string | null {
  if (rawHost === null) return null;
  const host = rawHost.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return host === "" ? null : host;
}

export interface ShopResolverDeps {
  readonly fetchShop: (hostname: string) => Promise<ResolvedShop | null>;
  readonly now: () => number;
  readonly ttlMs: number;
  readonly maxEntries?: number;
}

/** Caches answers (including "no such shop") for `ttlMs`; never caches a failure. */
export function createShopResolver(
  deps: ShopResolverDeps,
): (hostname: string) => Promise<ResolvedShop | null> {
  const cache = new Map<string, { value: ResolvedShop | null; expiresAt: number }>();
  const maxEntries = deps.maxEntries ?? 5000;
  return async (hostname) => {
    const hit = cache.get(hostname);
    if (hit !== undefined && hit.expiresAt > deps.now()) return hit.value;
    const value = await deps.fetchShop(hostname);
    cache.set(hostname, { value, expiresAt: deps.now() + deps.ttlMs });
    if (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  };
}

export function fetchShopFromRuntime(
  runtimeApiUrl: string,
  platformTenantId: string,
): (hostname: string) => Promise<ResolvedShop | null> {
  return async (hostname) => {
    const response = await fetch(
      `${runtimeApiUrl}/api/v1/public/domains/resolve?host=${encodeURIComponent(hostname)}`,
      { headers: { "x-tenant-id": platformTenantId }, cache: "no-store" },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`shop resolve failed with ${response.status}`);
    return (await response.json()) as ResolvedShop;
  };
}
