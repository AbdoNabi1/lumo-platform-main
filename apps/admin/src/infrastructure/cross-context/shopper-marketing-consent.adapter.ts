import type { ShopperMarketingConsentPort } from "@platform/checkout";
import type { CustomerController } from "@platform/identity";

/**
 * Wave 2a: the real `ShopperMarketingConsentPort` over Identity's `RecordShopperMarketingConsent`. The
 * shopper ticked the box at checkout, so the record says `shopper/checkout` (never the staff assertion).
 * A refusal is thrown so `CompleteCheckout` can log it as a warning; it never reaches the shopper.
 */
export class ShopperMarketingConsentAdapter implements ShopperMarketingConsentPort {
  private readonly customers: Pick<CustomerController, "recordShopperMarketingConsent">;

  constructor(customers: Pick<CustomerController, "recordShopperMarketingConsent">) {
    this.customers = customers;
  }

  async record(input: {
    readonly tenantId: string;
    readonly customerRef: string;
    readonly checkoutSessionId: string;
  }): Promise<void> {
    const response = await this.customers.recordShopperMarketingConsent({
      tenantId: input.tenantId,
      customerId: input.customerRef,
      granted: true,
      source: "checkout",
      checkoutId: input.checkoutSessionId,
    });
    if (response.status !== 200) {
      throw new Error(
        `ShopperMarketingConsentAdapter: Identity refused the consent (status ${response.status})`,
      );
    }
  }
}
