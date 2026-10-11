import { describe, expect, it } from "vitest";
import { NotFoundError, UniqueEntityId, ValidationError } from "@platform/domain";
import { TaxSettings, type TaxRegionInput } from "./tax-settings";

const id = (value: string) => UniqueEntityId.from(value);
const egypt: TaxRegionInput = { countryCode: "EG", rateBasisPoints: 1400, provinces: [] };

function fieldsOf(action: () => unknown): string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) return error.fields.map((issue) => issue.field);
    throw error;
  }
  return [];
}

describe("TaxSettings", () => {
  it("defaults to prices that include tax, no tax on shipping and no regions", () => {
    const s = TaxSettings.defaults();

    expect(s.pricesIncludeTax).toBe(true);
    expect(s.chargeTaxOnShipping).toBe(false);
    expect(s.regions).toEqual([]);
  });

  it("sets the two switches", () => {
    const s = TaxSettings.defaults();

    s.setFlags({ pricesIncludeTax: false, chargeTaxOnShipping: true });

    expect(s.pricesIncludeTax).toBe(false);
    expect(s.chargeTaxOnShipping).toBe(true);
  });

  it("adds a region with its province overrides, sorted by province code", () => {
    const s = TaxSettings.defaults();

    s.upsertRegion(id("r-1"), {
      ...egypt,
      provinces: [
        { code: "EG-GZ", rateBasisPoints: 500 },
        { code: "EG-C", rateBasisPoints: 1000 },
      ],
    });

    expect(s.regions).toHaveLength(1);
    expect(s.regions[0]).toMatchObject({
      countryCode: "EG",
      rateBasisPoints: 1400,
      provinces: [
        { code: "EG-C", rateBasisPoints: 1000 },
        { code: "EG-GZ", rateBasisPoints: 500 },
      ],
    });
  });

  it("holds one region per country: a second upsert replaces the first and keeps its id", () => {
    const s = TaxSettings.defaults();
    s.upsertRegion(id("r-1"), egypt);

    s.upsertRegion(id("r-2"), { ...egypt, rateBasisPoints: 1500 });

    expect(s.regions).toHaveLength(1);
    expect(s.regions[0]?.id.toString()).toBe("r-1");
    expect(s.regions[0]?.rateBasisPoints).toBe(1500);
  });

  it("looks a region up by country", () => {
    const s = TaxSettings.defaults();
    s.upsertRegion(id("r-1"), egypt);

    expect(s.regionFor("EG")?.rateBasisPoints).toBe(1400);
    expect(s.regionFor("SA")).toBeUndefined();
  });

  it.each([
    ["a negative rate", { rateBasisPoints: -1 }],
    ["a rate above 100%", { rateBasisPoints: 10_001 }],
    ["a fractional rate", { rateBasisPoints: 1400.5 }],
  ])("refuses %s", (_label, change) => {
    expect(
      fieldsOf(() => TaxSettings.defaults().upsertRegion(id("r"), { ...egypt, ...change })),
    ).toEqual(["rateBasisPoints"]);
  });

  it("accepts 0% and 100%", () => {
    const s = TaxSettings.defaults();
    s.upsertRegion(id("r-1"), { ...egypt, rateBasisPoints: 0 });
    s.upsertRegion(id("r-2"), { countryCode: "SA", rateBasisPoints: 10_000, provinces: [] });

    expect(s.regions.map((r) => r.rateBasisPoints)).toEqual([0, 10_000]);
  });

  it("refuses a country code that is not two capital letters", () => {
    for (const countryCode of ["eg", "EGY", "", "E1"]) {
      expect(
        fieldsOf(() => TaxSettings.defaults().upsertRegion(id("r"), { ...egypt, countryCode })),
      ).toEqual(["countryCode"]);
    }
  });

  it("refuses a province override that is out of range, repeated, or not of that country", () => {
    const upsert = (provinces: TaxRegionInput["provinces"]) => () =>
      TaxSettings.defaults().upsertRegion(id("r"), { ...egypt, provinces });

    expect(fieldsOf(upsert([{ code: "EG-C", rateBasisPoints: 20_000 }]))).toEqual(["provinces"]);
    expect(
      fieldsOf(
        upsert([
          { code: "EG-C", rateBasisPoints: 1 },
          { code: "EG-C", rateBasisPoints: 2 },
        ]),
      ),
    ).toEqual(["provinces"]);
    expect(fieldsOf(upsert([{ code: "SA-01", rateBasisPoints: 1 }]))).toEqual(["provinces"]);
  });

  it("removes a region, and refuses a country it does not hold", () => {
    const s = TaxSettings.defaults();
    s.upsertRegion(id("r-1"), egypt);

    s.removeRegion("EG");

    expect(s.regions).toEqual([]);
    expect(() => s.removeRegion("EG")).toThrow(NotFoundError);
  });
});
