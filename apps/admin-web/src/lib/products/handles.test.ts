import { describe, expect, it } from "vitest";
import { fallbackHandle, generateProductSku, handleFromTitle, variantSkuFor } from "./handles";

describe("handles and SKUs (Plan 2C-2)", () => {
  it("derives a Shopify-style ASCII handle from a title", () => {
    expect(handleFromTitle("Plush Teddy Bear")).toBe("plush-teddy-bear");
    expect(handleFromTitle("  Café — Crème! 2026 ")).toBe("cafe-creme-2026");
    expect(handleFromTitle("قميص قطن")).toBe(""); // the caller falls back
  });

  it("falls back to product-<token> and generates P-<TOKEN> product SKUs", () => {
    expect(fallbackHandle()).toMatch(/^product-[a-z0-9]{6}$/);
    expect(generateProductSku()).toMatch(/^P-[A-Z0-9]{6}$/);
  });

  it("builds variant SKUs from option values, unique against taken SKUs", () => {
    expect(variantSkuFor("P-ABC123", ["Red", "L"], new Set())).toBe("P-ABC123-RED-L");
    expect(variantSkuFor("P-ABC123", ["أحمر"], new Set())).toBe("P-ABC123-V1");
    expect(variantSkuFor("P-ABC123", ["L"], new Set(["P-ABC123-L"]))).toBe("P-ABC123-L-2");
  });
});
