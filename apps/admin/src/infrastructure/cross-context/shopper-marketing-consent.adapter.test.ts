import { describe, expect, it } from "vitest";
import type { CustomerController } from "@platform/identity";
import { ShopperMarketingConsentAdapter } from "./shopper-marketing-consent.adapter";

type Input = Parameters<CustomerController["recordShopperMarketingConsent"]>[0];

describe("ShopperMarketingConsentAdapter (Checkout -> Identity, Wave 2a)", () => {
  it("asks Identity for a shopper grant from checkout, naming the customer and the checkout", async () => {
    expect.hasAssertions();
    const seen: Input[] = [];
    const adapter = new ShopperMarketingConsentAdapter({
      recordShopperMarketingConsent: async (input) => {
        seen.push(input);
        return { status: 200, body: { customerId: input.customerId, recorded: true } };
      },
    });

    await adapter.record({ tenantId: "t1", customerRef: "c-1", checkoutSessionId: "cs-1" });

    expect(seen).toEqual([
      { tenantId: "t1", customerId: "c-1", granted: true, source: "checkout", checkoutId: "cs-1" },
    ]);
  });

  it("throws when Identity refuses, so Checkout can log a warning (the order is never undone)", async () => {
    expect.hasAssertions();
    const adapter = new ShopperMarketingConsentAdapter({
      recordShopperMarketingConsent: async () => ({ status: 404, body: { code: "NOT_FOUND" } }),
    });

    await expect(
      adapter.record({ tenantId: "t1", customerRef: "c-1", checkoutSessionId: "cs-1" }),
    ).rejects.toThrow(/status 404/);
  });
});
