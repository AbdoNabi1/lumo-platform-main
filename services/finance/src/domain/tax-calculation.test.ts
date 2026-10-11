import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { allocateDiscount, calculateTax, type TaxableLine } from "./tax-calculation";
import { TaxSettings } from "./tax-settings";

function settings(
  options: { includes?: boolean; shipping?: boolean },
  regions: {
    country: string;
    bp: number;
    provinces?: { code: string; rateBasisPoints: number }[];
  }[],
): TaxSettings {
  const s = TaxSettings.defaults();
  s.setFlags({
    pricesIncludeTax: options.includes ?? true,
    chargeTaxOnShipping: options.shipping ?? false,
  });
  regions.forEach((region, index) =>
    s.upsertRegion(UniqueEntityId.from(`r-${index}`), {
      countryCode: region.country,
      rateBasisPoints: region.bp,
      provinces: region.provinces ?? [],
    }),
  );
  return s;
}

const line = (unitPriceMinor: number, quantity = 1, taxable = true): TaxableLine => ({
  unitPriceMinor,
  quantity,
  taxable,
});

const EG = { country: "EG", bp: 1400 };

describe("calculateTax — inclusive prices", () => {
  it("EGP 114.00 at 14% holds EGP 14.00 of tax, already inside the price", () => {
    const result = calculateTax(
      settings({ includes: true }, [EG]),
      [line(11_400)],
      { country: "EG" },
      0,
    );

    expect(result).toEqual({ taxMinor: 1400, included: true });
  });

  it("multiplies by the quantity", () => {
    const result = calculateTax(settings({}, [EG]), [line(11_400, 3)], { country: "EG" }, 0);

    expect(result.taxMinor).toBe(4200);
  });
});

describe("calculateTax — exclusive prices", () => {
  it("100.00 at 14% adds EGP 14.00", () => {
    const result = calculateTax(
      settings({ includes: false }, [EG]),
      [line(10_000)],
      { country: "EG" },
      0,
    );

    expect(result).toEqual({ taxMinor: 1400, included: false });
  });
});

describe("calculateTax — which rate", () => {
  const withCairo = settings({ includes: false }, [
    { ...EG, provinces: [{ code: "EG-C", rateBasisPoints: 1000 }] },
  ]);

  it("a province rate replaces the country rate", () => {
    expect(
      calculateTax(withCairo, [line(10_000)], { country: "EG", province: "EG-C" }, 0).taxMinor,
    ).toBe(1000);
  });

  it("another province, or none, uses the country rate", () => {
    expect(
      calculateTax(withCairo, [line(10_000)], { country: "EG", province: "EG-GZ" }, 0).taxMinor,
    ).toBe(1400);
    expect(calculateTax(withCairo, [line(10_000)], { country: "EG" }, 0).taxMinor).toBe(1400);
  });

  it("a zero province rate means no tax there", () => {
    const zero = settings({ includes: false }, [
      { ...EG, provinces: [{ code: "EG-C", rateBasisPoints: 0 }] },
    ]);

    expect(
      calculateTax(zero, [line(10_000)], { country: "EG", province: "EG-C" }, 0).taxMinor,
    ).toBe(0);
  });

  it("no region for the destination means no tax — and still reports how prices are held", () => {
    expect(
      calculateTax(settings({ includes: true }, [EG]), [line(10_000)], { country: "SA" }, 0),
    ).toEqual({
      taxMinor: 0,
      included: true,
    });
    expect(
      calculateTax(settings({ includes: false }, []), [line(10_000)], { country: "EG" }, 0),
    ).toEqual({
      taxMinor: 0,
      included: false,
    });
  });

  it("a shop with no settings charges nothing (defaults: inclusive, no regions)", () => {
    expect(calculateTax(TaxSettings.defaults(), [line(10_000)], { country: "EG" }, 500)).toEqual({
      taxMinor: 0,
      included: true,
    });
  });
});

describe("calculateTax — what is taxed", () => {
  it("leaves out a line that is not taxable", () => {
    const result = calculateTax(
      settings({ includes: false }, [EG]),
      [line(10_000), line(50_000, 1, false)],
      { country: "EG" },
      0,
    );

    expect(result.taxMinor).toBe(1400);
  });

  it("taxes shipping only when the shop charges tax on shipping", () => {
    const off = calculateTax(
      settings({ includes: false, shipping: false }, [EG]),
      [line(10_000)],
      { country: "EG" },
      5000,
    );
    const on = calculateTax(
      settings({ includes: false, shipping: true }, [EG]),
      [line(10_000)],
      { country: "EG" },
      5000,
    );

    expect(off.taxMinor).toBe(1400);
    expect(on.taxMinor).toBe(1400 + 700);
  });

  it("with inclusive prices, tax on shipping is inside the shipping price", () => {
    const result = calculateTax(
      settings({ includes: true, shipping: true }, [EG]),
      [line(11_400)],
      { country: "EG" },
      5700,
    );

    expect(result).toEqual({ taxMinor: 1400 + 700, included: true });
  });

  it("charges nothing on a free shipping rate", () => {
    const result = calculateTax(
      settings({ includes: false, shipping: true }, [EG]),
      [line(10_000)],
      { country: "EG" },
      0,
    );

    expect(result.taxMinor).toBe(1400);
  });
});

describe("calculateTax — rounding", () => {
  it("rounds half up on minor units, line by line", () => {
    // 25 minor at 10%: 2.5 -> 3 per line, so three lines hold 9 — not round(75 * 10%) = 8.
    const tenPercent = settings({ includes: false }, [{ country: "EG", bp: 1000 }]);

    expect(
      calculateTax(tenPercent, [line(25), line(25), line(25)], { country: "EG" }, 0).taxMinor,
    ).toBe(9);
  });

  it("rounds an inclusive amount half up too", () => {
    // 11 minor at 14% inclusive: 11 * 14 / 114 = 1.35 -> 1; 13 -> 1.596 -> 2.
    const inclusive = settings({ includes: true }, [EG]);

    expect(calculateTax(inclusive, [line(11)], { country: "EG" }, 0).taxMinor).toBe(1);
    expect(calculateTax(inclusive, [line(13)], { country: "EG" }, 0).taxMinor).toBe(2);
  });

  it("works in whole numbers at a rate with two decimals (14.37%)", () => {
    const odd = settings({ includes: false }, [{ country: "EG", bp: 1437 }]);

    expect(calculateTax(odd, [line(10_000)], { country: "EG" }, 0).taxMinor).toBe(1437);
  });
});

describe("allocateDiscount (tax after discounts)", () => {
  it("splits a discount in proportion to the amounts", () => {
    expect(allocateDiscount([10_000, 10_000], 2000)).toEqual([1000, 1000]);
    expect(allocateDiscount([30_000, 10_000], 4000)).toEqual([3000, 1000]);
  });

  it("gives the remainder to the largest fractions, so the shares add up exactly", () => {
    const shares = allocateDiscount([3333, 3333, 3333], 100);

    expect(shares).toEqual([34, 33, 33]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("gives a remainder to the larger fraction first, not to the first line", () => {
    // 7 over 1:2 -> 2.33 / 4.67 -> floors 2 + 4, the spare unit goes to the 4.67
    expect(allocateDiscount([100, 200], 7)).toEqual([2, 5]);
  });

  it("never takes more than the amounts hold, and ignores a negative discount", () => {
    expect(allocateDiscount([500, 500], 5000)).toEqual([500, 500]);
    expect(allocateDiscount([500, 500], -10)).toEqual([0, 0]);
    expect(allocateDiscount([0, 0], 100)).toEqual([0, 0]);
    expect(allocateDiscount([], 100)).toEqual([]);
  });
});

describe("calculateTax — tax is worked out after discounts, like Shopify", () => {
  it("inclusive 14%: 100.00 + 100.00 with a 20.00 order discount is taxed on 90.00 + 90.00", () => {
    const result = calculateTax(
      settings({ includes: true }, [EG]),
      [line(10_000), line(10_000)],
      { country: "EG" },
      0,
      { orderMinor: 2000 },
    );

    // each 90.00 holds 90.00 × 0.14 / 1.14 = 11.05
    expect(result).toEqual({ taxMinor: 2 * 1105, included: true });
  });

  it("exclusive 14%: the same cart is taxed on 90.00 + 90.00", () => {
    const result = calculateTax(
      settings({ includes: false }, [EG]),
      [line(10_000), line(10_000)],
      { country: "EG" },
      0,
      { orderMinor: 2000 },
    );

    expect(result).toEqual({ taxMinor: 2 * 1260, included: false });
  });

  it("a line that is not taxable gets no share of the discount", () => {
    const result = calculateTax(
      settings({ includes: false }, [EG]),
      [line(10_000), line(10_000), line(10_000, 1, false)],
      { country: "EG" },
      0,
      { orderMinor: 2000 },
    );

    expect(result.taxMinor).toBe(2 * 1260);
  });

  it("a discount larger than the taxable lines leaves no tax", () => {
    const result = calculateTax(
      settings({ includes: false }, [EG]),
      [line(5000)],
      { country: "EG" },
      0,
      { orderMinor: 99_999 },
    );

    expect(result.taxMinor).toBe(0);
  });

  it("rounds each line after its own share, half up", () => {
    // 3 × 33.33 = 99.99 with a 1.00 discount: shares 34/33/33 -> 32.99 / 33.00 / 33.00 -> 4.62 + 4.62 + 4.62
    const result = calculateTax(
      settings({ includes: false }, [EG]),
      [line(3333), line(3333), line(3333)],
      { country: "EG" },
      0,
      { orderMinor: 100 },
    );

    expect(result.taxMinor).toBe(462 + 462 + 462);
  });

  it("shipping is taxed on its price after a shipping discount", () => {
    const result = calculateTax(
      settings({ includes: false, shipping: true }, [EG]),
      [],
      { country: "EG" },
      5000,
      { shippingMinor: 1000 },
    );

    expect(result.taxMinor).toBe(560);
  });

  it("a free shipping discount (the whole price) leaves no shipping tax", () => {
    const result = calculateTax(
      settings({ includes: false, shipping: true }, [EG]),
      [],
      { country: "EG" },
      5000,
      { shippingMinor: 5000 },
    );

    expect(result.taxMinor).toBe(0);
  });

  it("without discounts nothing changes", () => {
    const base = calculateTax(settings({}, [EG]), [line(11_400)], { country: "EG" }, 0);
    const none = calculateTax(settings({}, [EG]), [line(11_400)], { country: "EG" }, 0, {});

    expect(none).toEqual(base);
  });
});
