import { describe, expect, it } from "vitest";
import { NotFoundError, UniqueEntityId, ValidationError } from "@platform/domain";
import { ShippingZone, type RateInput } from "./shipping-zone";

const id = (value: string) => UniqueEntityId.from(value);

function zone(overrides: Partial<Parameters<typeof ShippingZone.create>[1]> = {}): ShippingZone {
  return ShippingZone.create(id("z-1"), {
    name: "Cairo and Giza",
    countries: [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }],
    ...overrides,
  });
}

function fieldsOf(action: () => unknown): string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields.map((issue) => issue.field);
    throw error;
  }
  return [];
}

const flat: RateInput = { name: "Standard", priceMinor: 5000 };

describe("ShippingZone", () => {
  it("is created with a trimmed name, its countries, the general profile and no rates", () => {
    const created = zone({ name: "  Cairo and Giza  " });

    expect(created.name).toBe("Cairo and Giza");
    expect(created.profile).toBe("general");
    expect(created.countries).toEqual([{ code: "EG", provinces: ["EG-C", "EG-GZ"] }]);
    expect(created.rates).toEqual([]);
  });

  it("holds a whole country as provinces: null and rest of world as `*`", () => {
    expect(zone({ countries: [{ code: "SA", provinces: null }] }).countries).toEqual([
      { code: "SA", provinces: null },
    ]);
    expect(zone({ countries: [{ code: "*", provinces: null }] }).countries).toEqual([
      { code: "*", provinces: null },
    ]);
  });

  it.each([
    ["a blank name", { name: "   " }],
    ["a name over 80 characters", { name: "x".repeat(81) }],
  ])("refuses %s", (_label, change) => {
    expect(fieldsOf(() => zone(change))).toEqual(["name"]);
  });

  it("accepts an 80-character name", () => {
    expect(fieldsOf(() => zone({ name: "x".repeat(80) }))).toEqual([]);
  });

  it("needs at least one country", () => {
    expect(fieldsOf(() => zone({ countries: [] }))).toEqual(["countries"]);
  });

  it("refuses the same country twice in one zone", () => {
    expect(
      fieldsOf(() =>
        zone({
          countries: [
            { code: "EG", provinces: null },
            { code: "EG", provinces: ["EG-C"] },
          ],
        }),
      ),
    ).toEqual(["countries"]);
  });

  it("refuses an empty province list (a whole country is provinces: null) and duplicate provinces", () => {
    expect(fieldsOf(() => zone({ countries: [{ code: "EG", provinces: [] }] }))).toEqual([
      "countries",
    ]);
    expect(
      fieldsOf(() => zone({ countries: [{ code: "EG", provinces: ["EG-C", "EG-C"] }] })),
    ).toEqual(["countries"]);
  });

  it("keeps rest of world on its own, whole", () => {
    expect(
      fieldsOf(() =>
        zone({
          countries: [
            { code: "*", provinces: null },
            { code: "EG", provinces: null },
          ],
        }),
      ),
    ).toEqual(["countries"]);
    expect(fieldsOf(() => zone({ countries: [{ code: "*", provinces: ["EG-C"] }] }))).toEqual([
      "countries",
    ]);
  });

  it("renames and replaces its countries with the same checks", () => {
    const z = zone();
    z.rename("  Greater Cairo ");
    z.setCountries([{ code: "SA", provinces: null }]);

    expect(z.name).toBe("Greater Cairo");
    expect(z.countries).toEqual([{ code: "SA", provinces: null }]);
    expect(fieldsOf(() => z.rename(""))).toEqual(["name"]);
    expect(fieldsOf(() => z.setCountries([]))).toEqual(["countries"]);
  });
});

describe("ShippingRate (through the zone)", () => {
  it("adds a rate with no condition by default, in order", () => {
    const z = zone();
    z.addRate(id("r-1"), flat);
    z.addRate(id("r-2"), { name: "Express", priceMinor: 10_000, description: " 1–2 days " });

    expect(z.rates.map((r) => [r.id.toString(), r.name, r.priceMinor, r.condition])).toEqual([
      ["r-1", "Standard", 5000, { type: "none" }],
      ["r-2", "Express", 10_000, { type: "none" }],
    ]);
    expect(z.rates[1]?.description).toBe("1–2 days");
    expect(z.rates[0]?.description).toBeNull();
    expect(z.rates.map((r) => r.position)).toEqual([0, 1]);
  });

  it("allows a free rate (price 0)", () => {
    const z = zone();
    z.addRate(id("r-1"), { name: "Free", priceMinor: 0 });

    expect(z.rates[0]?.priceMinor).toBe(0);
  });

  it.each([
    ["a blank name", { name: " " }, "name"],
    ["a name over 80 characters", { name: "x".repeat(81) }, "name"],
    ["a negative price", { priceMinor: -1 }, "priceMinor"],
    ["a fractional price", { priceMinor: 10.5 }, "priceMinor"],
    ["a description over 200 characters", { description: "x".repeat(201) }, "description"],
  ])("refuses %s", (_label, change, field) => {
    const z = zone();
    expect(fieldsOf(() => z.addRate(id("r-1"), { ...flat, ...change }))).toEqual([field]);
    expect(z.rates).toEqual([]);
  });

  it("holds an order price condition in minor units and a weight condition in grams", () => {
    const z = zone();
    z.addRate(id("r-1"), {
      ...flat,
      condition: { type: "orderPrice", minMinor: 100_000 },
    });
    z.addRate(id("r-2"), {
      ...flat,
      condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
    });

    expect(z.rates[0]?.condition).toEqual({ type: "orderPrice", minMinor: 100_000 });
    expect(z.rates[1]?.condition).toEqual({ type: "weight", minGrams: 0, maxGrams: 5000 });
  });

  it.each([
    [{ type: "orderPrice", minMinor: 5000, maxMinor: 1000 }],
    [{ type: "weight", minGrams: 2000, maxGrams: 1000 }],
    [{ type: "orderPrice", minMinor: -1 }],
    [{ type: "weight", maxGrams: 1.5 }],
  ] as const)("refuses the condition %j", (condition) => {
    expect(fieldsOf(() => zone().addRate(id("r-1"), { ...flat, condition }))).toEqual([
      "condition",
    ]);
  });

  it("accepts min equal to max only when it is a real range (min < max)", () => {
    expect(
      fieldsOf(() =>
        zone().addRate(id("r-1"), {
          ...flat,
          condition: { type: "orderPrice", minMinor: 1000, maxMinor: 1000 },
        }),
      ),
    ).toEqual(["condition"]);
  });

  it("treats a condition with neither bound as no condition at all", () => {
    const z = zone();
    z.addRate(id("r-1"), { ...flat, condition: { type: "orderPrice" } });
    z.addRate(id("r-2"), { ...flat, condition: { type: "weight" } });

    expect(z.rates.map((r) => r.condition)).toEqual([{ type: "none" }, { type: "none" }]);
  });

  it("updates a rate in place, keeping its id and position", () => {
    const z = zone();
    z.addRate(id("r-1"), flat);
    z.addRate(id("r-2"), { name: "Express", priceMinor: 10_000 });

    z.updateRate("r-1", { name: "Standard plus", priceMinor: 6000, description: null });

    expect(z.rates[0]).toMatchObject({ name: "Standard plus", priceMinor: 6000, position: 0 });
    expect(z.rates[0]?.id.toString()).toBe("r-1");
  });

  it("removes a rate and refuses an unknown one", () => {
    const z = zone();
    z.addRate(id("r-1"), flat);

    z.removeRate("r-1");
    expect(z.rates).toEqual([]);
    expect(() => z.removeRate("r-1")).toThrow(NotFoundError);
    expect(() => z.updateRate("nope", flat)).toThrow(NotFoundError);
  });
});
