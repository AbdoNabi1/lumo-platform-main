import { describe, expect, it, vi } from "vitest";
import { wireCatalog, type ProductController } from "@platform/catalog";
import { CheckoutItem } from "@platform/checkout";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { ShippingZonesController } from "@platform/shipping";
import type { TaxSettingsController } from "@platform/finance";
import {
  CheckoutShippingQuoteAdapter,
  CheckoutTaxCalculationAdapter,
} from "./checkout-shipping-tax.adapters";

const clock: Clock = { now: () => new Date("2026-10-11T00:00:00.000Z") };
const TENANT = "tenant-a";

function must<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`invalid fixture: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

interface VariantSpec {
  sku: string;
  priceAmountMinor?: number;
  weightGrams?: number;
  requiresShipping?: boolean;
  taxable?: boolean;
}

async function world() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const catalog = wireCatalog({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
  const lookups: string[] = [];
  const products: Pick<ProductController, "get"> = {
    get: (input) => {
      lookups.push(`${input.tenantId}:${input.productId}`);
      return catalog.products.get(input);
    },
  };

  async function seed(sku: string, spec: VariantSpec) {
    const created = await catalog.products.create({
      sku,
      name: sku,
      slug: sku.toLowerCase(),
      variants: [
        {
          sku: spec.sku,
          priceAmountMinor: spec.priceAmountMinor ?? 10_000,
          currency: "EGP",
          ...(spec.weightGrams === undefined ? {} : { weightGrams: spec.weightGrams }),
          ...(spec.requiresShipping === undefined
            ? {}
            : { requiresShipping: spec.requiresShipping }),
          ...(spec.taxable === undefined ? {} : { taxable: spec.taxable }),
        },
      ],
      tenantId: TENANT,
    } as never);
    const id = (created.body as { id: string }).id;
    await catalog.products.publish({ productId: id, tenantId: TENANT });
    const read = await catalog.products.get({ productId: id, tenantId: TENANT });
    const variantId = (
      read.body as { variants: { id: { toString(): string } }[] }
    ).variants[0]?.id.toString();
    if (variantId === undefined) throw new Error("fixture failed");
    return { productId: id, variantId };
  }

  return { seed, products, lookups };
}

function line(productId: string, variantId: string | undefined, unit: number, quantity = 1) {
  return must(
    CheckoutItem.create(
      productId,
      quantity,
      unit,
      "EGP",
      variantId === undefined
        ? undefined
        : { variantRef: variantId, sku: "SKU", title: "T", variantTitle: null },
    ),
  );
}

describe("CheckoutShippingQuoteAdapter (Plan 3C)", () => {
  it("asks Shipping with lines resolved from Catalog: the weight and whether the line needs shipping", async () => {
    const w = await world();
    const heavy = await w.seed("HEAVY", { sku: "HEAVY-1", weightGrams: 2500 });
    const digital = await w.seed("DIGITAL", { sku: "DIGI-1", requiresShipping: false });
    const quote = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        rates: [{ id: "r-1", name: "Standard", priceMinor: 5000, description: "2-4 days" }],
      },
    });
    const adapter = new CheckoutShippingQuoteAdapter(w.products, { quote } as unknown as Pick<
      ShippingZonesController,
      "quote"
    >);

    const result = await adapter.quote(
      { country: "EG", province: "EG-C", postalCode: "11511" },
      [
        line(heavy.productId, heavy.variantId, 10_000, 2),
        line(digital.productId, digital.variantId, 4000),
      ],
      "EGP",
      TENANT,
    );

    expect(result).toEqual([
      { method: "r-1", name: "Standard", rateAmountMinor: 5000, description: "2-4 days" },
    ]);
    expect(quote).toHaveBeenCalledWith({
      tenantId: TENANT,
      address: { country: "EG", province: "EG-C" },
      lines: [
        { unitPriceMinor: 10_000, quantity: 2, requiresShipping: true, weightGrams: 2500 },
        { unitPriceMinor: 4000, quantity: 1, requiresShipping: false, weightGrams: null },
      ],
    });
  });

  it("resolves a legacy line (no variant named) through the product's only variant", async () => {
    const w = await world();
    const mug = await w.seed("MUG", { sku: "MUG-1", weightGrams: 300 });
    const quote = vi.fn().mockResolvedValue({ status: 200, body: { rates: [] } });
    const adapter = new CheckoutShippingQuoteAdapter(w.products, { quote } as unknown as Pick<
      ShippingZonesController,
      "quote"
    >);

    await adapter.quote(
      { country: "EG", province: "EG-C", postalCode: "" },
      [line(mug.productId, undefined, 5000)],
      "EGP",
      TENANT,
    );

    expect(quote.mock.calls[0]?.[0].lines[0]).toMatchObject({
      requiresShipping: true,
      weightGrams: 300,
    });
  });

  it("looks every product up in the caller's own tenant", async () => {
    const w = await world();
    const mug = await w.seed("MUG", { sku: "MUG-1" });
    const quote = vi.fn().mockResolvedValue({ status: 200, body: { rates: [] } });
    const adapter = new CheckoutShippingQuoteAdapter(w.products, { quote } as unknown as Pick<
      ShippingZonesController,
      "quote"
    >);

    await adapter.quote(
      { country: "EG", postalCode: "" },
      [line(mug.productId, mug.variantId, 5000)],
      "EGP",
      TENANT,
    );

    expect(w.lookups).toEqual([`${TENANT}:${mug.productId}`]);
  });

  it("offers no rates for a cart it cannot resolve from Catalog — fails closed, never guesses a weight", async () => {
    const w = await world();
    const quote = vi.fn();
    const adapter = new CheckoutShippingQuoteAdapter(w.products, { quote } as unknown as Pick<
      ShippingZonesController,
      "quote"
    >);

    const result = await adapter.quote(
      { country: "EG", postalCode: "" },
      [line("00000000-0000-4000-8000-000000000000", undefined, 5000)],
      "EGP",
      TENANT,
    );

    expect(result).toEqual([]);
    expect(quote).not.toHaveBeenCalled();
  });

  it("offers no rates when Shipping refuses the question", async () => {
    const w = await world();
    const mug = await w.seed("MUG", { sku: "MUG-1" });
    const adapter = new CheckoutShippingQuoteAdapter(w.products, {
      quote: async () => ({ status: 422, body: {} }),
    } as unknown as Pick<ShippingZonesController, "quote">);

    expect(
      await adapter.quote(
        { country: "EG", postalCode: "" },
        [line(mug.productId, mug.variantId, 1)],
        "EGP",
        TENANT,
      ),
    ).toEqual([]);
  });
});

describe("CheckoutTaxCalculationAdapter (Plan 3C)", () => {
  it("asks Finance with lines whose `taxable` comes from Catalog, not from the session", async () => {
    const w = await world();
    const taxed = await w.seed("TAXED", { sku: "TAXED-1" });
    const exempt = await w.seed("EXEMPT", { sku: "EXEMPT-1", taxable: false });
    const calculate = vi
      .fn()
      .mockResolvedValue({ status: 200, body: { taxMinor: 1400, included: true } });
    const adapter = new CheckoutTaxCalculationAdapter(w.products, { calculate } as unknown as Pick<
      TaxSettingsController,
      "calculate"
    >);

    const result = await adapter.calculate(
      [
        line(taxed.productId, taxed.variantId, 11_400),
        line(exempt.productId, exempt.variantId, 5000, 2),
      ],
      { country: "EG", province: "EG-C" },
      5000,
      "EGP",
      TENANT,
    );

    expect(result).toEqual({ taxMinor: 1400, included: true });
    expect(calculate).toHaveBeenCalledWith({
      tenantId: TENANT,
      lines: [
        { unitPriceMinor: 11_400, quantity: 1, taxable: true },
        { unitPriceMinor: 5000, quantity: 2, taxable: false },
      ],
      destination: { country: "EG", province: "EG-C" },
      shippingMinor: 5000,
    });
  });

  it("treats a line it cannot resolve as taxable — the catalog default — rather than dropping its tax", async () => {
    const w = await world();
    const calculate = vi
      .fn()
      .mockResolvedValue({ status: 200, body: { taxMinor: 0, included: false } });
    const adapter = new CheckoutTaxCalculationAdapter(w.products, { calculate } as unknown as Pick<
      TaxSettingsController,
      "calculate"
    >);

    await adapter.calculate(
      [line("00000000-0000-4000-8000-000000000000", undefined, 1000)],
      { country: "EG" },
      0,
      "EGP",
      TENANT,
    );

    expect(calculate.mock.calls[0]?.[0].lines).toEqual([
      { unitPriceMinor: 1000, quantity: 1, taxable: true },
    ]);
  });

  it("throws when Finance cannot answer, so no tax is silently dropped", async () => {
    const w = await world();
    const taxed = await w.seed("TAXED", { sku: "TAXED-1" });
    const adapter = new CheckoutTaxCalculationAdapter(w.products, {
      calculate: async () => ({ status: 500, body: {} }),
    } as unknown as Pick<TaxSettingsController, "calculate">);

    await expect(
      adapter.calculate(
        [line(taxed.productId, taxed.variantId, 1)],
        { country: "EG" },
        0,
        "EGP",
        TENANT,
      ),
    ).rejects.toThrow(/tax/i);
  });
});

describe("CheckoutTaxCalculationAdapter — after discounts (follow-up to Plan 3C)", () => {
  it("hands the order and shipping discounts to Finance, which taxes the discounted amounts", async () => {
    const w = await world();
    const taxed = await w.seed("TAXED", { sku: "TAXED-1" });
    const calculate = vi
      .fn()
      .mockResolvedValue({ status: 200, body: { taxMinor: 2210, included: true } });
    const adapter = new CheckoutTaxCalculationAdapter(w.products, { calculate } as unknown as Pick<
      TaxSettingsController,
      "calculate"
    >);

    await adapter.calculate(
      [line(taxed.productId, taxed.variantId, 10_000, 2)],
      { country: "EG" },
      5000,
      "EGP",
      TENANT,
      { orderMinor: 2000, shippingMinor: 1000 },
    );

    expect(calculate).toHaveBeenCalledWith(
      expect.objectContaining({ orderDiscountMinor: 2000, shippingDiscountMinor: 1000 }),
    );
  });

  it("sends no discount fields when none is given", async () => {
    const w = await world();
    const taxed = await w.seed("TAXED", { sku: "TAXED-1" });
    const calculate = vi
      .fn()
      .mockResolvedValue({ status: 200, body: { taxMinor: 0, included: true } });
    const adapter = new CheckoutTaxCalculationAdapter(w.products, { calculate } as unknown as Pick<
      TaxSettingsController,
      "calculate"
    >);

    await adapter.calculate(
      [line(taxed.productId, taxed.variantId, 10_000)],
      { country: "EG" },
      0,
      "EGP",
      TENANT,
    );

    const sent = calculate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("orderDiscountMinor");
    expect(sent).not.toHaveProperty("shippingDiscountMinor");
  });
});
