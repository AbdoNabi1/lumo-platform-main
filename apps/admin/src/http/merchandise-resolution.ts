import type { Product } from "@platform/catalog";
import { ValidationError, toErrorEnvelope } from "@platform/utils";
import type { WiredAdmin } from "../composition";
import { variantOf } from "../infrastructure/cross-context/variant-of";
import type { PageResponse } from "./public-catalog-routes";

export type MerchandiseResolution =
  | {
      readonly status: "ok";
      readonly productId: string;
      readonly variantId: string;
      readonly sku: string;
      readonly title: string;
      readonly variantTitle: string | null;
      readonly amountMinor: number;
      readonly currency: string;
    }
  | { readonly status: "choose_variant" }
  | { readonly status: "unavailable" };

/** Variant label such as `"Red / L"`: the selected values in the PRODUCT's option order, `null` when none. */
export function variantTitleOf(
  options: readonly { readonly name: string; readonly values: readonly string[] }[],
  selection: Readonly<Record<string, string>> | null,
): string | null {
  if (selection === null) return null;
  const parts = options
    .map((option) => selection[option.name])
    .filter((value): value is string => value !== undefined);
  return parts.length === 0 ? null : parts.join(" / ");
}

/**
 * Plan 2A: the price and snapshot of the exact variant being sold (Shopify's merchandise). The
 * price is the VARIANT's, read server-side from Catalog — never from the caller, and no longer the
 * product-level Pricing row (the retired `resolvePrice`), which cannot price two sizes differently.
 */
export async function resolveMerchandise(
  admin: WiredAdmin,
  input: { readonly productId: string; readonly variantId?: string },
  tenantId: string,
): Promise<MerchandiseResolution> {
  const response = await admin.publicReads.products.get({ productId: input.productId, tenantId });
  if (response.status !== 200) return { status: "unavailable" };
  const product = response.body as Product;
  // Plan 2C-1: sellable = published, or unlisted (reachable by its link, never listed).
  if (!product.status.isSellable || product.deleted) return { status: "unavailable" };
  const variant = variantOf(product, input.variantId);
  if (variant === undefined) {
    return input.variantId === undefined ? { status: "choose_variant" } : { status: "unavailable" };
  }
  const options = product.options.map((o) => ({ name: o.name, values: [...o.values] }));
  return {
    status: "ok",
    productId: product.id.value,
    variantId: variant.id.value,
    sku: variant.sku.value,
    title: product.name,
    variantTitle: variantTitleOf(options, variant.selection?.values ?? null),
    amountMinor: variant.price.amountMinor,
    currency: variant.price.currency,
  };
}

/** The response for every non-`"ok"` {@link MerchandiseResolution}. */
export function merchandiseUnresolvedResponse(resolution: {
  readonly status: "choose_variant" | "unavailable";
}): PageResponse {
  if (resolution.status === "choose_variant") {
    return {
      status: 422,
      body: {
        code: "VARIANT_REQUIRED",
        message: "Choose a variant (size, color…) for this product",
        retryable: false,
        fields: [{ field: "variantId", message: "required for a product with several variants" }],
      },
    };
  }
  return {
    status: 422,
    body: toErrorEnvelope(new ValidationError("Unable to resolve a price for this product")),
  };
}
