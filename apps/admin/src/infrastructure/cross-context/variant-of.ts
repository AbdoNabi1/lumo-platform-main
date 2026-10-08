import type { Product } from "@platform/catalog";

/**
 * The variant an order/checkout line means (Plan 2A rule): the named one; with none named, the
 * product's only variant; with several and none named, nothing — never a guess.
 */
export function variantOf(
  product: Product,
  variantRef: string | undefined | null,
): Product["variants"][number] | undefined {
  if (variantRef !== undefined && variantRef !== null) {
    return product.variants.find((variant) => variant.id.toString() === variantRef);
  }
  return product.variants.length === 1 ? product.variants[0] : undefined;
}
