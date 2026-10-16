import type { Product, ProductController } from "@platform/catalog";
import type {
  CheckoutItem,
  ShippingCalculationPort,
  ShippingQuote,
  TaxCalculationPort,
  TaxCalculationResult,
} from "@platform/checkout";
import type { TaxSettingsController } from "@platform/finance";
import type { QuoteLine, ShippingZonesController } from "@platform/shipping";
import { variantOf } from "./variant-of";

/** What Catalog says about one checkout line; `null` when the product or its variant cannot be resolved. */
interface CatalogLine {
  readonly requiresShipping: boolean;
  readonly weightGrams: number | null;
  readonly taxable: boolean;
}

/**
 * Reads every line's shipping and tax facts from CATALOG, in the caller's tenant — never from the
 * session snapshot (which carries a price and a quantity, nothing else). A line whose product or
 * variant cannot be resolved comes back `null`, and each adapter decides what that means for it.
 */
async function resolveLines(
  products: Pick<ProductController, "get">,
  items: readonly CheckoutItem[],
  tenantId: string,
): Promise<(CatalogLine | null)[]> {
  const resolved: (CatalogLine | null)[] = [];
  for (const item of items) {
    const response = await products.get({ productId: item.productRef, tenantId });
    if (response.status !== 200) {
      resolved.push(null);
      continue;
    }
    const variant = variantOf(response.body as Product, item.variantRef);
    resolved.push(
      variant === undefined
        ? null
        : {
            requiresShipping: variant.attributes.requiresShipping,
            weightGrams: variant.attributes.weightGrams,
            taxable: variant.attributes.taxable,
          },
    );
  }
  return resolved;
}

interface QuotedRatesBody {
  readonly rates: readonly {
    readonly id: string;
    readonly name: string;
    readonly priceMinor: number;
    readonly description: string | null;
  }[];
}

/**
 * Real `ShippingCalculationPort` (Plan 3C): the shop's shipping zones and rates, quoted for the
 * address and for lines resolved from Catalog (weight, whether the line needs shipping). Replaces the
 * fixed 5/15 stub. No quotes means "the shop does not ship to this address" — which is also what a
 * cart it cannot resolve from Catalog gets: it fails closed rather than guess a weight, because
 * Shipping's rates can depend on it.
 *
 * Stateless per tenant (ADR-0014): the tenant arrives with each call.
 */
export class CheckoutShippingQuoteAdapter implements ShippingCalculationPort {
  private readonly products: Pick<ProductController, "get">;
  private readonly zones: Pick<ShippingZonesController, "quote">;

  constructor(
    products: Pick<ProductController, "get">,
    zones: Pick<ShippingZonesController, "quote">,
  ) {
    this.products = products;
    this.zones = zones;
  }

  async quote(
    shippingAddress: {
      readonly country: string;
      readonly province?: string | undefined;
      readonly postalCode: string;
    },
    items: readonly CheckoutItem[],
    _currency: string,
    tenantId: string,
  ): Promise<readonly ShippingQuote[]> {
    const resolved = await resolveLines(this.products, items, tenantId);
    const lines: QuoteLine[] = [];
    for (const [index, catalogLine] of resolved.entries()) {
      const item = items[index];
      if (catalogLine === null || item === undefined) return [];
      lines.push({
        unitPriceMinor: item.unitPriceAmountMinor,
        quantity: item.quantity,
        requiresShipping: catalogLine.requiresShipping,
        weightGrams: catalogLine.weightGrams,
      });
    }

    const response = await this.zones.quote({
      tenantId,
      address: {
        country: shippingAddress.country,
        ...(shippingAddress.province === undefined ? {} : { province: shippingAddress.province }),
      },
      lines,
    });
    if (response.status !== 200) return [];
    return (response.body as QuotedRatesBody).rates.map((rate) => ({
      method: rate.id,
      name: rate.name,
      rateAmountMinor: rate.priceMinor,
      ...(rate.description === null ? {} : { description: rate.description }),
    }));
  }
}

/**
 * Real `TaxCalculationPort` (Plan 3C): the tax under the shop's own settings (Taxes and duties) —
 * inclusive or added, per country and province, on the taxable lines resolved from Catalog and on
 * shipping when the shop charges tax on it. Replaces the flat 10% stub; with no region configured the
 * tax is zero. A line it cannot resolve is treated as taxable (Catalog's default) rather than quietly
 * dropped from the tax; a failure from Finance throws, so a tax is never silently lost.
 */
export class CheckoutTaxCalculationAdapter implements TaxCalculationPort {
  private readonly products: Pick<ProductController, "get">;
  private readonly taxes: Pick<TaxSettingsController, "calculate">;

  constructor(
    products: Pick<ProductController, "get">,
    taxes: Pick<TaxSettingsController, "calculate">,
  ) {
    this.products = products;
    this.taxes = taxes;
  }

  async calculate(
    items: readonly CheckoutItem[],
    destination: { readonly country: string; readonly province?: string | undefined },
    shippingMinor: number,
    _currency: string,
    tenantId: string,
    discounts?: { readonly orderMinor: number; readonly shippingMinor: number },
  ): Promise<TaxCalculationResult> {
    const resolved = await resolveLines(this.products, items, tenantId);
    const response = await this.taxes.calculate({
      tenantId,
      lines: items.map((item, index) => ({
        unitPriceMinor: item.unitPriceAmountMinor,
        quantity: item.quantity,
        taxable: resolved[index]?.taxable ?? true,
      })),
      destination: {
        country: destination.country,
        ...(destination.province === undefined ? {} : { province: destination.province }),
      },
      shippingMinor,
      // Tax is worked out after discounts: Finance takes them off the taxable lines and the shipping price.
      ...(discounts === undefined || discounts.orderMinor === 0
        ? {}
        : { orderDiscountMinor: discounts.orderMinor }),
      ...(discounts === undefined || discounts.shippingMinor === 0
        ? {}
        : { shippingDiscountMinor: discounts.shippingMinor }),
    });
    if (response.status !== 200) {
      throw new Error(
        `CheckoutTaxCalculationAdapter: Finance could not calculate the tax (status ${response.status}): ` +
          JSON.stringify(response.body),
      );
    }
    const body = response.body as TaxCalculationResult;
    return { taxMinor: body.taxMinor, included: body.included };
  }
}
