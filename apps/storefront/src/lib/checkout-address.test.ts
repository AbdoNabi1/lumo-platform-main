import { describe, expect, it } from "vitest";
import { COUNTRY_CODES } from "@platform/regions";
import {
  countryName,
  countryOptions,
  defaultCountry,
  isCountryCode,
  isValidPhone,
  normalizePhone,
  provinceLabelKey,
} from "./checkout-address";

describe("normalizePhone", () => {
  it("turns Arabic-Indic and Persian digits into ASCII and drops spaces, dashes and brackets", () => {
    expect(normalizePhone("٠١٠ ١٢٣٤ ٥٦٧٨")).toBe("01012345678");
    expect(normalizePhone("۰۱۰۱۲۳۴۵۶۷۸")).toBe("01012345678");
    expect(normalizePhone("+20 (10) 1234-5678")).toBe("+201012345678");
  });
});

describe("isValidPhone", () => {
  it("accepts 7 to 15 digits with an optional leading +", () => {
    expect(isValidPhone("0101234567")).toBe(true);
    expect(isValidPhone("+201012345678")).toBe(true);
    expect(isValidPhone("1234567")).toBe(true);
  });

  it("rejects letters, too few or too many digits, and a misplaced +", () => {
    for (const bad of ["12ab", "123456", "1234567890123456", "01+012345678", ""]) {
      expect(isValidPhone(bad), bad).toBe(false);
    }
  });
});

describe("countryOptions (Plan 3C)", () => {
  it("offers exactly the countries the shop's zones ship to, named in the page's language and sorted by name", () => {
    const options = countryOptions({ countries: ["SA", "EG", "AE"], restOfWorld: false }, "en");

    expect(options.map((option) => option.code)).toEqual(["EG", "SA", "AE"]);
    expect(options[0]?.name).toBe("Egypt");
    const arabic = countryOptions({ countries: ["SA", "EG"], restOfWorld: false }, "ar");
    expect(arabic.find((option) => option.code === "EG")?.name).toBe("مصر");
  });

  it("offers every country when the shop ships to the rest of the world", () => {
    const options = countryOptions({ countries: ["EG"], restOfWorld: true }, "en");

    expect(options).toHaveLength(COUNTRY_CODES.length);
    expect(options.map((option) => option.code)).toContain("US");
  });

  it("offers none when the shop ships nowhere yet, or when the list could not be loaded", () => {
    expect(countryOptions({ countries: [], restOfWorld: false }, "en")).toEqual([]);
    expect(countryOptions(null, "en")).toEqual([]);
  });

  it("drops a code that is not an ISO country", () => {
    expect(countryOptions({ countries: ["EG", "XX1"], restOfWorld: false }, "en")).toHaveLength(1);
  });
});

describe("defaultCountry", () => {
  it("prefers Egypt when it is offered, else the first offered, else nothing", () => {
    expect(
      defaultCountry([
        { code: "SA", name: "x" },
        { code: "EG", name: "y" },
      ]),
    ).toBe("EG");
    expect(defaultCountry([{ code: "SA", name: "x" }])).toBe("SA");
    expect(defaultCountry([])).toBe("");
  });
});

describe("isCountryCode / countryName / provinceLabelKey", () => {
  it("recognises ISO codes only", () => {
    expect(isCountryCode("EG")).toBe(true);
    expect(isCountryCode("Egypt")).toBe(false);
  });

  it("falls back to the code for a name the runtime does not know", () => {
    expect(countryName("EG", "en")).toBe("Egypt");
    expect(countryName("ZZZ", "en")).toBe("ZZZ");
  });

  it("names the province field after the country: governorate, region, emirate", () => {
    expect(provinceLabelKey("EG")).toBe("governorate");
    expect(provinceLabelKey("SA")).toBe("region");
    expect(provinceLabelKey("AE")).toBe("emirate");
    expect(provinceLabelKey("US")).toBeNull();
  });
});
