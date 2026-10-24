import type { WiredAdmin } from "../composition";

/** What a link URL needs of a shop domain (Tenancy's `ShopDomainView` satisfies it). */
export interface ShopDomainLike {
  readonly hostname: string;
  readonly status: string;
  readonly isPrimary: boolean;
}

/** Spec §3.6: the primary VERIFIED hostname — a pending domain does not serve the shop yet. */
export function primaryHostnameOf(domains: readonly ShopDomainLike[]): string | null {
  return (
    domains.find((domain) => domain.isPrimary && domain.status === "verified")?.hostname ?? null
  );
}

/** `https://<host><path>`, or null when the shop has no domain (admin-web then uses STOREFRONT_URL). */
export function shopLinkUrl(hostname: string | null, path: string): string | null {
  return hostname === null ? null : `https://${hostname}${path}`;
}

/** The shop's name as the storefront shows it — no permission needed (it is public). "" if unreadable. */
export async function shopNameOf(admin: Pick<WiredAdmin, "tenancy">): Promise<string> {
  const response = await admin.tenancy.getPublicStore();
  if (response.status !== 200) return "";
  const name = (response.body as { readonly name?: unknown }).name;
  return typeof name === "string" ? name : "";
}
