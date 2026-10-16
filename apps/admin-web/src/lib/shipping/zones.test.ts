import { describe, expect, it } from "vitest";
import { PROVINCES } from "@platform/regions";
import {
  countriesFromSelection,
  countryState,
  selectionFromCountries,
  takenBy,
  toggleCountry,
  toggleProvince,
  type ZoneCountryDto,
  type ZoneDto,
} from "./zones";

const EG_ALL = (PROVINCES["EG"] ?? []).map((p) => p.code);

function zone(id: string, name: string, countries: ZoneCountryDto[]): ZoneDto {
  return { id, name, profile: "general", countries, rates: [] };
}

describe("selection <-> countries", () => {
  it("round-trips whole countries, partial countries and rest of world", () => {
    const countries: ZoneCountryDto[] = [
      { code: "SA", provinces: null },
      { code: "EG", provinces: ["EG-C", "EG-GZ"] },
      { code: "*", provinces: null },
    ];

    expect(countriesFromSelection(selectionFromCountries(countries))).toEqual([
      { code: "*", provinces: null },
      { code: "EG", provinces: ["EG-C", "EG-GZ"] },
      { code: "SA", provinces: null },
    ]);
  });

  it("ticking a country ticks every governorate, which is the whole country (provinces: null)", () => {
    const selection = toggleCountry({}, "EG", true);

    expect(countryState(selection, "EG")).toBe("all");
    expect(countriesFromSelection(selection)).toEqual([{ code: "EG", provinces: null }]);
  });

  it("unticking a country clears it", () => {
    const selection = toggleCountry(toggleCountry({}, "EG", true), "EG", false);

    expect(countryState(selection, "EG")).toBe("none");
    expect(countriesFromSelection(selection)).toEqual([]);
  });

  it("unticking one governorate of a whole country leaves the other 26", () => {
    const selection = toggleProvince(toggleCountry({}, "EG", true), "EG", "EG-C", false);

    expect(countryState(selection, "EG")).toBe("some");
    const [egypt] = countriesFromSelection(selection);
    expect(egypt?.provinces).toHaveLength(26);
    expect(egypt?.provinces).not.toContain("EG-C");
  });

  it("ticking governorates one by one is partial until the last makes the whole country", () => {
    let selection = toggleProvince({}, "EG", "EG-C", true);
    expect(countryState(selection, "EG")).toBe("some");
    expect(countriesFromSelection(selection)).toEqual([{ code: "EG", provinces: ["EG-C"] }]);

    for (const code of EG_ALL) selection = toggleProvince(selection, "EG", code, true);

    expect(countryState(selection, "EG")).toBe("all");
    expect(countriesFromSelection(selection)).toEqual([{ code: "EG", provinces: null }]);
  });

  it("unticking the last governorate removes the country", () => {
    const selection = toggleProvince(toggleProvince({}, "EG", "EG-C", true), "EG", "EG-C", false);

    expect(countryState(selection, "EG")).toBe("none");
    expect(countriesFromSelection(selection)).toEqual([]);
  });

  it("a country without province data is all or nothing", () => {
    expect(countryState(toggleCountry({}, "US", true), "US")).toBe("all");
    expect(countriesFromSelection(toggleCountry({}, "US", true))).toEqual([
      { code: "US", provinces: null },
    ]);
  });

  it("rest of world stands alone: ticking it clears the others, ticking a country clears it", () => {
    const withCountries = toggleCountry(toggleCountry({}, "EG", true), "SA", true);

    const world = toggleCountry(withCountries, "*", true);
    expect(countriesFromSelection(world)).toEqual([{ code: "*", provinces: null }]);

    const back = toggleCountry(world, "SA", true);
    expect(countriesFromSelection(back)).toEqual([{ code: "SA", provinces: null }]);
  });
});

describe("takenBy — what other zones already hold", () => {
  const zones = [
    zone("z1", "Cairo and Giza", [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }]),
    zone("z2", "Saudi", [{ code: "SA", provinces: null }]),
    zone("z3", "World", [{ code: "*", provinces: null }]),
  ];

  it("names the zone holding a whole country, a province, or rest of world", () => {
    const taken = takenBy(zones, "other");

    expect(taken.get("SA")?.whole).toBe("Saudi");
    expect(taken.get("EG")?.whole).toBeUndefined();
    expect(taken.get("EG")?.provinces.get("EG-C")).toBe("Cairo and Giza");
    expect(taken.get("*")?.whole).toBe("World");
  });

  it("does not count the zone being edited", () => {
    const taken = takenBy(zones, "z2");

    expect(taken.has("SA")).toBe(false);
    expect(taken.has("EG")).toBe(true);
  });
});
