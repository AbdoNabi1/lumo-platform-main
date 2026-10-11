import { describe, expect, it } from "vitest";

import {
  COUNTRY_CODES,
  CURRENCY_CODES,
  PROVINCES,
  hasProvinces,
  isCurrencyCode,
  isProvinceOf,
  provinceName,
} from "./index";

describe("CURRENCY_CODES / isCurrencyCode", () => {
  it("lists ISO 4217 codes once, uppercase, including the ones the shops use", () => {
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    for (const code of CURRENCY_CODES) expect(code).toMatch(/^[A-Z]{3}$/);
    expect(CURRENCY_CODES).toEqual(expect.arrayContaining(["EGP", "SAR", "AED", "USD", "EUR"]));
  });
  it("accepts a listed code and rejects anything else", () => {
    expect(isCurrencyCode("EGP")).toBe(true);
    expect(isCurrencyCode("egp")).toBe(false);
    expect(isCurrencyCode("XXX")).toBe(false);
    expect(isCurrencyCode("")).toBe(false);
  });
});

describe("COUNTRY_CODES", () => {
  it("lists every ISO 3166-1 alpha-2 code once, uppercase", () => {
    expect(COUNTRY_CODES.length).toBe(249);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(COUNTRY_CODES).toEqual(expect.arrayContaining(["EG", "SA", "AE", "US"]));
  });
});

describe("PROVINCES", () => {
  it("has the 27 governorates of Egypt with unique codes", () => {
    const eg = PROVINCES["EG"] ?? [];
    expect(eg).toHaveLength(27);
    expect(new Set(eg.map((p) => p.code)).size).toBe(27);
  });

  it("has 13 regions for SA and 7 emirates for AE", () => {
    expect(PROVINCES["SA"]).toHaveLength(13);
    expect(PROVINCES["AE"]).toHaveLength(7);
  });

  it("gives every entry an en and an ar name and a code that starts with its country", () => {
    for (const [country, list] of Object.entries(PROVINCES)) {
      for (const p of list) {
        expect(p.en.length).toBeGreaterThan(0);
        expect(p.ar.length).toBeGreaterThan(0);
        expect(p.code.startsWith(`${country}-`)).toBe(true);
      }
    }
  });
});

describe("provinceName", () => {
  it("returns the Arabic name for EG-C", () => {
    expect(provinceName("EG-C", "ar")).toBe("القاهرة");
  });
  it("returns the English name", () => {
    expect(provinceName("EG-GZ", "en")).toBe("Giza");
  });
  it("falls back to the code for an unknown province", () => {
    expect(provinceName("EG-ZZ", "en")).toBe("EG-ZZ");
  });
});

describe("hasProvinces / isProvinceOf", () => {
  it("knows which countries have province data", () => {
    expect(hasProvinces("EG")).toBe(true);
    expect(hasProvinces("US")).toBe(false);
  });
  it("checks a province belongs to its country", () => {
    expect(isProvinceOf("EG", "EG-C")).toBe(true);
    expect(isProvinceOf("EG", "SA-01")).toBe(false);
    expect(isProvinceOf("US", "US-CA")).toBe(false);
  });
});
