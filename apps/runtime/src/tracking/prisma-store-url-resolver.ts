/**
 * `https://<store primary domain>/` for a store (Tracking P2-D7): the `event_source_url` of last resort of a server
 * business event that has no visitor page url (an order with no attribution snapshot, a delivery, a cancellation).
 *
 * Source: `tenancy.shop_domains`. The table is scoped to the PLATFORM tenant and names the merchant in `shop_ref`
 * (the same rule `PrismaShopDomainRepository` follows), so the read runs in the platform tenant's scope and filters on
 * `shopRef`. Order of preference:
 *
 * 1. the primary VERIFIED domain (a pending domain does not serve the shop yet),
 * 2. any verified domain of kind `platform` (the store's address on the platform),
 * 3. `STOREFRONT_PUBLIC_URL` (the platform storefront's own address, the fallback every link builder uses),
 * 4. nothing: `null`, and the caller decides.
 *
 * A short per-store cache (a domain changes once in a blue moon; an order burst reads it once). A failed read is not
 * cached and is an error for the caller: a conversion must be retried, not sent with a made-up address.
 */

import { runReadScoped, type Database } from "@platform/db";

const CACHE_MS = 5 * 60_000;

function originOf(url: string | undefined): string | null {
  if (url === undefined || url.trim() === "") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? `${parsed.origin}/` : null;
  } catch {
    return null;
  }
}

export interface StoreUrlResolver {
  /** `https://<host>/` of the store, or `null` when nothing names it. */
  storeUrlOf(tenantId: string): Promise<string | null>;
}

export class PrismaStoreUrlResolver implements StoreUrlResolver {
  private readonly cache = new Map<string, { readonly url: string | null; readonly at: number }>();

  constructor(
    private readonly deps: {
      readonly db: Database;
      /** The tenant `tenancy.shop_domains` rows are filed under (`TENANT_DEFAULT_ID`). */
      readonly platformTenantId: string;
      /** `STOREFRONT_PUBLIC_URL`. */
      readonly fallbackUrl?: string;
      readonly clock: { now(): Date };
    },
  ) {}

  async storeUrlOf(tenantId: string): Promise<string | null> {
    const now = this.deps.clock.now().getTime();
    const cached = this.cache.get(tenantId);
    if (cached !== undefined && now - cached.at < CACHE_MS) return cached.url;

    const { platformTenantId } = this.deps;
    const rows = await runReadScoped(this.deps.db, platformTenantId, (tx) =>
      tx.shopDomain.findMany({
        where: { tenantId: platformTenantId, shopRef: tenantId, status: "verified" },
        select: { hostname: true, isPrimary: true, kind: true },
        orderBy: { hostname: "asc" },
      }),
    );
    const host =
      rows.find((row) => row.isPrimary)?.hostname ??
      rows.find((row) => row.kind === "platform")?.hostname;
    const url = host === undefined ? originOf(this.deps.fallbackUrl) : `https://${host}/`;
    this.cache.set(tenantId, { url, at: now });
    return url;
  }
}
