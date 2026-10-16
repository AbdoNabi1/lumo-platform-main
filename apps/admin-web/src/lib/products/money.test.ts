import { describe, expect, it } from "vitest";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "./money";

describe("money (Plan 2C-2)", () => {
  it("knows each currency's minor-unit exponent", () => {
    expect(currencyExponent("EGP")).toBe(2);
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });

  it("parses a typed amount into minor units without floating point", () => {
    expect(toMinorUnits("150", "EGP")).toBe(15000);
    expect(toMinorUnits("150.5", "EGP")).toBe(15050);
    expect(toMinorUnits("0.29", "USD")).toBe(29); // 0.29 * 100 is 28.999… in floats
    expect(toMinorUnits(" 1,250.75 ", "USD")).toBe(125075);
    expect(toMinorUnits("١٥٠٫٥", "EGP")).toBe(15050); // Arabic-Indic digits and separator
    expect(toMinorUnits("12.345", "KWD")).toBe(12345);
    expect(toMinorUnits("500", "JPY")).toBe(500);
  });

  it("rejects what is not a non-negative amount within the currency's decimals", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1.2.3", "1e3", "."]) {
      expect(toMinorUnits(bad, "EGP"), bad).toBeNull();
    }
    expect(toMinorUnits("5.5", "JPY")).toBeNull();
  });

  it("formats minor units back for an input's default value", () => {
    expect(fromMinorUnits(15050, "EGP")).toBe("150.50");
    expect(fromMinorUnits(29, "USD")).toBe("0.29");
    expect(fromMinorUnits(500, "JPY")).toBe("500");
    expect(fromMinorUnits(12345, "KWD")).toBe("12.345");
  });
});
