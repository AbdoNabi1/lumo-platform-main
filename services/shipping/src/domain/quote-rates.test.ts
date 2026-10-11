import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { quoteRates, type QuoteLine } from "./quote-rates";
import { ShippingZone, type RateInput, type ZoneCountry } from "./shipping-zone";

let counter = 0;
function zone(name: string, countries: ZoneCountry[], rates: RateInput[]): ShippingZone {
  counter += 1;
  const z = ShippingZone.create(UniqueEntityId.from(`z-${counter}`), { name, countries });
  rates.forEach((rate, index) => z.addRate(UniqueEntityId.from(`${name}-r${index}`), rate));
  return z;
}

const line = (overrides: Partial<QuoteLine> = {}): QuoteLine => ({
  unitPriceMinor: 10_000,
  quantity: 1,
  requiresShipping: true,
  weightGrams: 500,
  ...overrides,
});

const names = (rates: readonly { name: string }[]) => rates.map((r) => r.name);

describe("quoteRates — which zone", () => {
  const cairo = zone(
    "Cairo",
    [{ code: "EG", provinces: ["EG-C"] }],
    [{ name: "Cairo std", priceMinor: 5000 }],
  );
  const restOfEgypt = zone(
    "Rest of Egypt",
    [{ code: "EG", provinces: ["EG-GZ", "EG-ALX"] }],
    [{ name: "Egypt std", priceMinor: 7500 }],
  );
  const saudi = zone(
    "Saudi",
    [{ code: "SA", provinces: null }],
    [{ name: "Saudi std", priceMinor: 20_000 }],
  );
  const world = zone(
    "World",
    [{ code: "*", provinces: null }],
    [{ name: "World std", priceMinor: 90_000 }],
  );
  const all = [cairo, restOfEgypt, saudi, world];

  it("quotes the zone that lists the address's province", () => {
    expect(names(quoteRates(all, { country: "EG", province: "EG-C" }, [line()]))).toEqual([
      "Cairo std",
    ]);
    expect(names(quoteRates(all, { country: "EG", province: "EG-GZ" }, [line()]))).toEqual([
      "Egypt std",
    ]);
  });

  it("quotes a zone holding the whole country when no zone lists the province", () => {
    expect(names(quoteRates(all, { country: "SA", province: "SA-01" }, [line()]))).toEqual([
      "Saudi std",
    ]);
    expect(names(quoteRates(all, { country: "SA" }, [line()]))).toEqual(["Saudi std"]);
  });

  it("a province beats a whole country, which beats rest of world", () => {
    const wholeEgypt = zone(
      "All Egypt",
      [{ code: "EG", provinces: null }],
      [{ name: "Egypt all", priceMinor: 1 }],
    );
    const rates = quoteRates([world, wholeEgypt, cairo], { country: "EG", province: "EG-C" }, [
      line(),
    ]);
    expect(names(rates)).toEqual(["Cairo std"]);
    expect(
      names(quoteRates([world, wholeEgypt], { country: "EG", province: "EG-C" }, [line()])),
    ).toEqual(["Egypt all"]);
    expect(names(quoteRates([world, wholeEgypt], { country: "FR" }, [line()]))).toEqual([
      "World std",
    ]);
  });

  it("falls to rest of world for a country no zone lists", () => {
    expect(names(quoteRates(all, { country: "FR" }, [line()]))).toEqual(["World std"]);
  });

  it("a province no zone lists in a country that lists only other provinces falls through to rest of world", () => {
    expect(names(quoteRates(all, { country: "EG", province: "EG-SUZ" }, [line()]))).toEqual([
      "World std",
    ]);
  });

  it("returns no rates when no zone matches", () => {
    expect(quoteRates([cairo, saudi], { country: "FR" }, [line()])).toEqual([]);
    expect(quoteRates([], { country: "EG", province: "EG-C" }, [line()])).toEqual([]);
  });
});

describe("quoteRates — which rates", () => {
  const rates = (conditioned: RateInput[]) => [
    zone("Egypt", [{ code: "EG", provinces: null }], conditioned),
  ];
  const address = { country: "EG" } as const;

  it("returns every unconditioned rate, cheapest first, then by position", () => {
    const z = rates([
      { name: "Express", priceMinor: 10_000 },
      { name: "Standard", priceMinor: 5000 },
      { name: "Also 5000", priceMinor: 5000 },
    ]);

    expect(names(quoteRates(z, address, [line()]))).toEqual(["Standard", "Also 5000", "Express"]);
  });

  it("gives each rate its id, name, price and description", () => {
    const z = rates([{ name: "Standard", priceMinor: 5000, description: "2–4 business days" }]);

    expect(quoteRates(z, address, [line()])).toEqual([
      {
        id: "Egypt-r0",
        name: "Standard",
        priceMinor: 5000,
        description: "2–4 business days",
      },
    ]);
  });

  it("an order price condition is inclusive at the minimum and exclusive at the maximum", () => {
    const z = rates([
      {
        name: "Free over 1000",
        priceMinor: 0,
        condition: { type: "orderPrice", minMinor: 100_000 },
      },
      {
        name: "Small orders",
        priceMinor: 5000,
        condition: { type: "orderPrice", maxMinor: 100_000 },
      },
    ]);
    const order = (subtotal: number) => [line({ unitPriceMinor: subtotal })];

    expect(names(quoteRates(z, address, order(99_999)))).toEqual(["Small orders"]);
    expect(names(quoteRates(z, address, order(100_000)))).toEqual(["Free over 1000"]);
    expect(names(quoteRates(z, address, order(100_001)))).toEqual(["Free over 1000"]);
  });

  it("the order price is the subtotal of the lines (price times quantity)", () => {
    const z = rates([
      { name: "Free", priceMinor: 0, condition: { type: "orderPrice", minMinor: 100_000 } },
    ]);

    expect(
      names(
        quoteRates(z, address, [
          line({ unitPriceMinor: 60_000 }),
          line({ unitPriceMinor: 20_000, quantity: 2 }),
        ]),
      ),
    ).toEqual(["Free"]);
    expect(names(quoteRates(z, address, [line({ unitPriceMinor: 99_999 })]))).toEqual([]);
  });

  it("a weight condition sums weight times quantity over lines that require shipping only", () => {
    const z = rates([
      {
        name: "Light",
        priceMinor: 5000,
        condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
      },
      { name: "Heavy", priceMinor: 9000, condition: { type: "weight", minGrams: 5000 } },
    ]);
    const lines = [
      line({ weightGrams: 2000, quantity: 2 }),
      line({ weightGrams: 900_000, requiresShipping: false }),
    ];

    expect(names(quoteRates(z, address, lines))).toEqual(["Light"]);
    expect(names(quoteRates(z, address, [...lines, line({ weightGrams: 1000 })]))).toEqual([
      "Heavy",
    ]);
  });

  it("a line with no recorded weight counts as zero grams", () => {
    const z = rates([
      { name: "Light", priceMinor: 5000, condition: { type: "weight", maxGrams: 1000 } },
    ]);

    expect(names(quoteRates(z, address, [line({ weightGrams: null })]))).toEqual(["Light"]);
  });

  it("returns no rates when the zone matches but no rate's condition does", () => {
    const z = rates([
      {
        name: "Only big orders",
        priceMinor: 0,
        condition: { type: "orderPrice", minMinor: 500_000 },
      },
    ]);

    expect(quoteRates(z, address, [line()])).toEqual([]);
  });
});

describe("quoteRates — nothing to ship", () => {
  it("answers one implicit free rate when no line requires shipping, whatever the address", () => {
    const lines = [line({ requiresShipping: false }), line({ requiresShipping: false })];

    expect(quoteRates([], { country: "FR" }, lines)).toEqual([
      { id: "none", name: "No shipping required", priceMinor: 0, description: null },
    ]);
  });

  it("still ships a mixed cart: only the physical lines count toward weight", () => {
    const z = [
      zone("Egypt", [{ code: "EG", provinces: null }], [{ name: "Standard", priceMinor: 5000 }]),
    ];

    expect(
      names(quoteRates(z, { country: "EG" }, [line(), line({ requiresShipping: false })])),
    ).toEqual(["Standard"]);
  });
});
