import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { calculateTax, type TaxableLine } from "./tax-calculation";
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
