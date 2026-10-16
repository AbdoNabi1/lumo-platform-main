import type { ProductController } from "@platform/catalog";
import { UnexpectedError } from "@platform/utils";

/**
 * Plan 3C: Tenancy owns the store currency, Catalog owns the prices. When the merchant changes the
 * currency, this relabels every variant of the shop (amounts kept, as in Shopify). It is called after
 * the settings are saved and is idempotent, so when it throws the route answers 500 and the merchant's
 * retry finishes the job.
 */
export class StoreCurrencyRelabelAdapter {
  private readonly products: Pick<ProductController, "relabelVariantCurrency">;

  constructor(products: Pick<ProductController, "relabelVariantCurrency">) {
    this.products = products;
  }

  async relabel(tenantId: string, currency: string): Promise<void> {
    const response = await this.products.relabelVariantCurrency({ tenantId, currency });
    if (response.status >= 300) {
      throw new UnexpectedError(
        `Could not relabel variant prices to ${currency} (status ${response.status})`,
      );
    }
  }
}
