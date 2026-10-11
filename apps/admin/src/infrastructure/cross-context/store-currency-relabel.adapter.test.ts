import { describe, expect, it, vi } from "vitest";
import type { ProductController } from "@platform/catalog";
import { StoreCurrencyRelabelAdapter } from "./store-currency-relabel.adapter";

function adapter(response: { status: number; body?: unknown }) {
  const relabelVariantCurrency = vi.fn().mockResolvedValue(response);
  const products = { relabelVariantCurrency } as unknown as Pick<
    ProductController,
    "relabelVariantCurrency"
  >;
  return { adapter: new StoreCurrencyRelabelAdapter(products), relabelVariantCurrency };
}

describe("StoreCurrencyRelabelAdapter (Plan 3C)", () => {
  it("asks Catalog to relabel the tenant's variants to the currency", async () => {
    const { adapter: a, relabelVariantCurrency } = adapter({ status: 200 });
    await a.relabel("t-1", "EGP");
    expect(relabelVariantCurrency).toHaveBeenCalledWith({ tenantId: "t-1", currency: "EGP" });
  });

  it("throws when Catalog refuses, so the caller can answer 500 and the merchant can retry", async () => {
    const { adapter: a } = adapter({ status: 422, body: { error: "bad" } });
    await expect(a.relabel("t-1", "EGP")).rejects.toThrow(/relabel/i);
  });
});
