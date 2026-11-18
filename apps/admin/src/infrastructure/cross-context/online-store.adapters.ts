import type {
  ImageDto,
  ImageRefsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "@platform/online-store";
import { ScryptPasswordHasher } from "@platform/security";

type Response = { readonly status: number; readonly body: unknown };
type Resolved = {
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
};

/**
 * Ruling 13: every adapter is an object literal of CLOSURES. No adapter keeps a reference to the
 * media or tenancy controller as a property, so the tenant-mode guard (which walks object properties,
 * never closures) cannot reach tenancy's pinned internals through `onlineStore`.
 */
export function mediaImageRefs(
  existingIds: (ids: readonly string[], tenantId: string) => Promise<readonly string[]>,
  resolve: (ids: readonly string[], tenantId: string) => Promise<ReadonlyMap<string, Resolved>>,
): ImageRefsPort {
  return {
    existingIds: (ids, tenantId) => existingIds(ids, tenantId),
    resolve: async (ids, tenantId) => {
      const found = await resolve(ids, tenantId);
      const out: Record<string, ImageDto> = {};
      for (const [id, image] of found)
        out[id] = { url: image.url, alt: image.alt, width: image.width, height: image.height };
      return out;
    },
  };
}

/** The storefront password uses the platform's scrypt hasher (Plan 1B-1), constant-cost compare. */
export function scryptStorefrontPasswordHasher(
  options: { readonly log2N?: number } = {},
): StorefrontPasswordHasher {
  const hasher = new ScryptPasswordHasher(options);
  return {
    hash: (plain) => hasher.hash(plain),
    verify: (plain, hash) => hasher.verify(plain, hash),
  };
}

/** ADR-0014 8f exemption (spec "what stays pinned" 2): tenancy's domain list for this shop. */
export function tenancyShopHost(
  listShopDomains: (shopId: string) => Promise<Response>,
): ShopHostPort {
  return {
    primaryHostname: async (tenantId) => {
      const res = await listShopDomains(tenantId);
      if (res.status !== 200) return null;
      const items =
        (
          res.body as {
            items?: readonly { hostname?: unknown; status?: unknown; isPrimary?: unknown }[];
          }
        ).items ?? [];
      const primary = items.find(
        (d) => d.isPrimary === true && d.status === "verified" && typeof d.hostname === "string",
      );
      return (primary?.hostname as string | undefined) ?? null;
    },
  };
}

/** Resolve the store name for the tenant supplied by each caller. */
export function tenancyStoreIdentity(
  getPublicStore: (tenantId: string) => Promise<Response>,
): StoreIdentityPort {
  return {
    storeName: async (tenantId) => {
      try {
        const res = await getPublicStore(tenantId);
        const name = res.status === 200 ? (res.body as { name?: unknown } | null)?.name : undefined;
        return typeof name === "string" ? name.trim() : "";
      } catch {
        return ""; // a missing name must not fail a preferences read or the storefront shell
      }
    },
  };
}
