import { describe, expect, it } from "vitest";
import { PROVINCES } from "@platform/regions";
import {
  CAIRO_GIZA,
  GREATER_CAIRO,
  RATE_PRESETS,
  homeCountryFor,
  looksLikePrice,
  quickSetupPlan,
  ratePreset,
  remainingProvinces,
  suggestZoneName,
} from "./quick-setup";
import type { Selection, ZoneCountryDto, ZoneDto } from "./zones";

const EG_CODES = (PROVINCES["EG"] ?? []).map((p) => p.code);

function zone(id: string, name: string, countries: ZoneCountryDto[]): ZoneDto {
  return { id, name, profile: "general", countries, rates: [] };
}

const cairoZone = zone("z1", "Cairo", [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }]);
const egyptZone = zone("z2", "Egypt", [{ code: "EG", provinces: null }]);

describe("remainingProvinces", () => {
  it("is every province of the country when no zone holds any", () => {
    expect(remainingProvinces("EG", [], null)).toEqual(EG_CODES);
  });

  it("leaves out the provinces another zone holds", () => {
    const remaining = remainingProvinces("EG", [cairoZone], null);

    expect(remaining).toEqual(EG_CODES.filter((code) => code !== "EG-C" && code !== "EG-GZ"));
  });

  it("is empty when another zone holds the whole country", () => {
    expect(remainingProvinces("EG", [egyptZone], null)).toEqual([]);
  });

  it("does not count the zone being edited", () => {
    expect(remainingProvinces("EG", [cairoZone], "z1")).toEqual(EG_CODES);
  });

  it("is empty for a country with no province data", () => {
    expect(remainingProvinces("US", [], null)).toEqual([]);
  });
});

describe("province shortcuts", () => {
  it("Cairo and Giza is two governorates and Greater Cairo adds Qalyubia", () => {
    expect(CAIRO_GIZA).toEqual(["EG-C", "EG-GZ"]);
    expect(GREATER_CAIRO).toEqual(["EG-C", "EG-GZ", "EG-KB"]);
  });
});

describe("suggestZoneName", () => {
  const some = (code: string, provinces: string[]): Selection => ({ [code]: new Set(provinces) });

  it("is empty for an empty selection", () => {
    expect(suggestZoneName({}, [], null, "en")).toBe("");
  });

  it("names a whole country", () => {
    expect(suggestZoneName({ SA: "all" }, [], null, "en")).toBe("Saudi Arabia");
    expect(suggestZoneName({ EG: "all" }, [], null, "ar")).toBe("مصر");
  });

  it("joins one to three provinces, with 'and' before the last", () => {
    expect(suggestZoneName(some("EG", ["EG-C"]), [], null, "en")).toBe("Cairo");
    expect(suggestZoneName(some("EG", ["EG-C", "EG-GZ"]), [], null, "en")).toBe("Cairo and Giza");
    expect(suggestZoneName(some("EG", ["EG-C", "EG-GZ"]), [], null, "ar")).toBe("القاهرة والجيزة");
    expect(suggestZoneName(some("EG", GREATER_CAIRO.slice()), [], null, "en")).toBe(
      "Cairo, Giza and Qalyubia",
    );
    expect(suggestZoneName(some("EG", GREATER_CAIRO.slice()), [], null, "ar")).toBe(
      "القاهرة، الجيزة والقليوبية",
    );
  });

  it("calls the governorates other zones leave over 'Rest of Egypt'", () => {
    const rest = some("EG", remainingProvinces("EG", [cairoZone], null));

    expect(suggestZoneName(rest, [cairoZone], null, "en")).toBe("Rest of Egypt");
    expect(suggestZoneName(rest, [cairoZone], null, "ar")).toBe("باقي محافظات مصر");
  });

  it("uses the country's own noun for the rest of Saudi Arabia and the UAE", () => {
    const sa = zone("z3", "Riyadh", [{ code: "SA", provinces: ["SA-01"] }]);
    const ae = zone("z4", "Dubai", [{ code: "AE", provinces: ["AE-DU"] }]);

    expect(
      suggestZoneName(some("SA", remainingProvinces("SA", [sa], null)), [sa], null, "ar"),
    ).toBe("باقي مناطق السعودية");
    expect(
      suggestZoneName(some("AE", remainingProvinces("AE", [ae], null)), [ae], null, "ar"),
    ).toBe("باقي إمارات الإمارات");
  });

  it("names the first two countries and counts the others", () => {
    expect(suggestZoneName({ SA: "all", AE: "all" }, [], null, "en")).toBe(
      "United Arab Emirates, Saudi Arabia",
    );
    expect(suggestZoneName({ SA: "all", AE: "all", EG: "all" }, [], null, "en")).toBe(
      "United Arab Emirates, Egypt +1",
    );
  });

  it("uses the rest-of-world label", () => {
    expect(suggestZoneName({ "*": "all" }, [], null, "en")).toBe("Rest of world");
    expect(suggestZoneName({ "*": "all" }, [], null, "ar")).toBe("باقي دول العالم");
  });
});

describe("rate presets", () => {
  it("has standard, express and custom", () => {
    expect(RATE_PRESETS).toEqual(["standard", "express", "custom"]);
  });

  it("fills the name and the transit time in the admin's locale", () => {
    expect(ratePreset("standard", "en")).toEqual({
      name: "Standard",
      description: "2–4 business days",
    });
    expect(ratePreset("standard", "ar")).toEqual({
      name: "شحن عادي",
      description: "من 2 لـ 4 أيام عمل",
    });
    expect(ratePreset("express", "en")).toEqual({
      name: "Express",
      description: "1–2 business days",
    });
    expect(ratePreset("express", "ar")).toEqual({
      name: "شحن سريع",
      description: "من يوم لـ يومين عمل",
    });
  });

  it("custom is empty", () => {
    expect(ratePreset("custom", "en")).toEqual({ name: "", description: "" });
  });
});

describe("looksLikePrice", () => {
  it.each(["50", " 50 ", "50 EGP", "EGP 50", "ج.م 50", "٥٠", "1,250.50", "SAR50", "$ 50"])(
    "is true for %j",
    (name) => {
      expect(looksLikePrice(name)).toBe(true);
    },
  );

  it.each(["Standard", "شحن عادي", "Express 2 days", "", "   "])("is false for %j", (name) => {
    expect(looksLikePrice(name)).toBe(false);
  });
});

describe("quickSetupPlan", () => {
  const base = { cityPriceMinor: 5000, restPriceMinor: 7500, freeOverMinor: null, zones: [] };
  const standardEn = { name: "Standard", description: "2–4 business days" };

  it("Egypt: Cairo and Giza at the city price, the other governorates at the rest price", () => {
    const plan = quickSetupPlan({ ...base, country: "EG", locale: "en" });

    expect(plan).toEqual([
      {
        name: "Cairo and Giza",
        countries: [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }],
        rates: [{ ...standardEn, priceMinor: 5000, condition: { type: "none" } }],
      },
      {
        name: "Rest of Egypt",
        countries: [
          { code: "EG", provinces: EG_CODES.filter((c) => c !== "EG-C" && c !== "EG-GZ") },
        ],
        rates: [{ ...standardEn, priceMinor: 7500, condition: { type: "none" } }],
      },
    ]);
  });

  it("names the zones and the standard rate in Arabic", () => {
    const plan = quickSetupPlan({ ...base, country: "EG", locale: "ar" });

    expect(plan.map((z) => z.name)).toEqual(["القاهرة والجيزة", "باقي محافظات مصر"]);
    expect(plan[0]?.rates[0]).toMatchObject({
      name: "شحن عادي",
      description: "من 2 لـ 4 أيام عمل",
    });
  });

  it.each(["SA", "AE"])("%s: one zone for the whole country, the rest price ignored", (country) => {
    const plan = quickSetupPlan({ ...base, country, locale: "en" });

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      countries: [{ code: country, provinces: null }],
      rates: [{ name: "Standard", priceMinor: 5000 }],
    });
  });

  it("with a free-shipping threshold each zone gets exactly one option for any order total", () => {
    const plan = quickSetupPlan({ ...base, freeOverMinor: 100_000, country: "EG", locale: "en" });

    for (const z of plan) {
      expect(z.rates).toHaveLength(2);
      expect(z.rates[0]).toMatchObject({
        name: "Standard",
        condition: { type: "orderPrice", maxMinor: 100_000 },
      });
      expect(z.rates[1]).toEqual({
        name: "Free shipping",
        priceMinor: 0,
        condition: { type: "orderPrice", minMinor: 100_000 },
        description: "2–4 business days",
      });
    }
  });

  it("calls the free rate 'شحن مجاني' in Arabic", () => {
    const plan = quickSetupPlan({ ...base, freeOverMinor: 100_000, country: "SA", locale: "ar" });

    expect(plan[0]?.rates[1]?.name).toBe("شحن مجاني");
  });

  it("leaves out provinces another zone already holds, and a zone that would be empty", () => {
    const plan = quickSetupPlan({ ...base, country: "EG", locale: "en", zones: [cairoZone] });

    expect(plan).toHaveLength(1);
    expect(plan[0]?.name).toBe("Rest of Egypt");
    expect(
      quickSetupPlan({ ...base, country: "SA", locale: "en", zones: [egyptZone] }),
    ).toHaveLength(1);
    expect(
      quickSetupPlan({
        ...base,
        country: "EG",
        locale: "en",
        zones: [egyptZone],
      }),
    ).toEqual([]);
  });
});

describe("homeCountryFor", () => {
  it.each([
    ["EGP", "EG"],
    ["SAR", "SA"],
    ["AED", "AE"],
    ["USD", "EG"],
  ])("%s ships from %s", (currency, country) => {
    expect(homeCountryFor(currency)).toBe(country);
  });
});
