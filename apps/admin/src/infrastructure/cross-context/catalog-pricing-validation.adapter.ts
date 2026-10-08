import type { Product, ProductController } from "@platform/catalog";
import type {
  CheckoutItem,
  PricingValidationPort,
  PricingValidationResult,
} from "@platform/checkout";

/**
 * Plan 2C-1 (closes G-94): the staff checkout `/validate` price check reads the Catalog VARIANT —
 * the same single price source the cart routes have used since Plan 2A — instead of a product-level
 * Pricing row. A legacy line with no variant is checked against the product's only variant; a
 * product with several variants and no variant named is never guessed at.
 *
 * Stateless per tenant (ADR-0014): `PricingValidationPort.validate` carries `tenantId` per call, and
 * the lookup is by the ITEM's product id inside that tenant, so one tenant can never validate a
 * snapshot against another tenant's catalog.
 */
export class CatalogPricingValidationAdapter implements PricingValidationPort {
  private readonly products: Pick<ProductController, "get">;

  constructor(products: Pick<ProductController, "get">) {
    this.products = products;
  }

  async validate(
    items: readonly CheckoutItem[],
    currency: string,
    tenantId: string,
  ): Promise<PricingValidationResult> {
    for (const item of items) {
      const response = await this.products.get({ productId: item.productRef, tenantId });
      if (response.status !== 200) {
        return { valid: false, reason: `product "${item.productRef}" not found` };
      }
      const product = response.body as Product;
      if (!product.status.isSellable || product.deleted) {
        return { valid: false, reason: `product "${item.productRef}" is not for sale` };
      }
      const variant =
        item.variantRef === undefined
          ? product.variants.length === 1
            ? product.variants[0]
            : undefined
          : product.variants.find((v) => v.id.toString() === item.variantRef);
      if (variant === undefined) {
        return { valid: false, reason: `no matching variant for product "${item.productRef}"` };
      }
      if (variant.price.currency !== currency) {
        return { valid: false, reason: `currency mismatch for product "${item.productRef}"` };
      }
      if (variant.price.amountMinor !== item.unitPriceAmountMinor) {
        return {
          valid: false,
          reason: `stale price snapshot for product "${item.productRef}" — the variant price has changed`,
        };
      }
    }
    return { valid: true };
  }
}
