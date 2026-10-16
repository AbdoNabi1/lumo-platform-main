import type { BrandDto } from "@/lib/api/brands";
import { handleFromTitle, randomToken } from "./handles";

export type VendorChoice =
  | { readonly kind: "none" }
  | { readonly kind: "existing"; readonly brandId: string }
  | { readonly kind: "new"; readonly name: string; readonly slug: string };

/**
 * What a typed vendor means (Plan 2C-4). Blank: no brand. A name that matches an existing brand,
 * ignoring case and surrounding spaces: that brand. Anything else: a new brand, whose slug is the
 * name as a handle, or `brand-<token>` when the name has no Latin letters (the catalog `Slug`
 * accepts only `[a-z0-9-]`, so an Arabic name has nothing to make a slug from).
 */
export function resolveVendor(vendor: string, brands: readonly BrandDto[]): VendorChoice {
  const name = vendor.trim();
  if (name.length === 0) return { kind: "none" };

  const wanted = name.toLowerCase();
  const existing = brands.find((brand) => brand.name.trim().toLowerCase() === wanted);
  if (existing !== undefined) return { kind: "existing", brandId: existing.id };

  return { kind: "new", name, slug: handleFromTitle(name) || `brand-${randomToken(6)}` };
}
