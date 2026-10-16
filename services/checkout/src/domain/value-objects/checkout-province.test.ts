import { describe, expect, it } from "vitest";
import { CheckoutAddress } from "./checkout-address";
import { CheckoutItem } from "./checkout-item";
import { CheckoutTotals } from "./checkout-totals";
import { ShippingSelection } from "./selections";

const base = { line1: "1 Main St", city: "Cairo", postalCode: "11511", country: "EG" };

function item(unit: number, quantity = 1): CheckoutItem {
  const created = CheckoutItem.create("prod-1", quantity, unit, "EGP");
  if (!created.ok) throw created.error;
  return created.value;
}

describe("CheckoutAddress — province (Plan 3C)", () => {
  it("is optional, and absent by default", () => {
    const result = CheckoutAddress.create(base);

    expect(result.ok && result.value.province).toBeUndefined();
  });

  it("keeps a trimmed ISO 3166-2 code", () => {
    const result = CheckoutAddress.create({ ...base, province: " EG-C " });

    expect(result.ok && result.value.province).toBe("EG-C");
  });

  it("treats a blank province as none", () => {
    const result = CheckoutAddress.create({ ...base, province: "   " });

    expect(result.ok && result.value.province).toBeUndefined();
  });

  it("refuses a province longer than 10 characters", () => {
    const result = CheckoutAddress.create({ ...base, province: "EG-ABCDEFGHI" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fields.map((f) => f.field)).toContain("province");
  });

  it("makes two addresses in different provinces different values", () => {
    const cairo = CheckoutAddress.create({ ...base, province: "EG-C" });
    const giza = CheckoutAddress.create({ ...base, province: "EG-GZ" });

    expect(cairo.ok && giza.ok && cairo.value.equals(giza.value)).toBe(false);
  });
});

describe("ShippingSelection — name and description (Plan 3C)", () => {
  it("snapshots the rate's name and description alongside its price", () => {
    const result = ShippingSelection.create("rate-1", 5000, "EGP", {
      name: "Standard",
      description: "2–4 business days",
    });

    expect(result.ok && result.value.name).toBe("Standard");
    expect(result.ok && result.value.description).toBe("2–4 business days");
  });

  it("leaves both absent for a selection made without them", () => {
    const result = ShippingSelection.create("standard", 500, "USD");

    expect(result.ok && result.value.name).toBeUndefined();
    expect(result.ok && result.value.description).toBeUndefined();
  });
});

describe("CheckoutTotals — tax included or added (Plan 3C)", () => {
  it("adds tax to the total by default, as before", () => {
    const totals = CheckoutTotals.assemble([item(10_000)], 1400, 500, 0, "EGP");

    expect(totals.totalMinor).toBe(10_000 + 1400 + 500);
    expect(totals.taxIncluded).toBe(false);
  });

  it("keeps tax OUT of the total when prices already include it", () => {
    const totals = CheckoutTotals.assemble([item(11_400)], 1400, 500, 0, "EGP", {
      taxIncluded: true,
    });

    expect(totals.totalMinor).toBe(11_400 + 500);
    expect(totals.taxMinor).toBe(1400);
    expect(totals.taxIncluded).toBe(true);
  });

  it("subtracts the discount in both modes and never goes below zero", () => {
    expect(
      CheckoutTotals.assemble([item(10_000)], 1400, 0, 2000, "EGP", { taxIncluded: true })
        .totalMinor,
    ).toBe(8000);
    expect(CheckoutTotals.assemble([item(1000)], 0, 0, 5000, "EGP").totalMinor).toBe(0);
  });

  it("carries the shipping rate's name", () => {
    const totals = CheckoutTotals.assemble([item(10_000)], 0, 500, 0, "EGP", {
      shippingName: "Standard",
    });

    expect(totals.shippingName).toBe("Standard");
    expect(CheckoutTotals.assemble([item(10_000)], 0, 0, 0, "EGP").shippingName).toBeUndefined();
  });
});
