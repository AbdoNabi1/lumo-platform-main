import { describe, expect, it } from "vitest";
import { formatCurrency } from "./format";

describe("formatCurrency — the currency's own minor-unit exponent (Plan 2B-1)", () => {
  it("shows two decimals for EGP", () => {
    expect(formatCurrency("en", 15050, "EGP")).toContain("150.50");
  });

  it("shows three decimals for KWD, where 12345 minor units is 12.345", () => {
    expect(formatCurrency("en", 12345, "KWD")).toContain("12.345");
  });

  it("shows no decimals for JPY", () => {
    const text = formatCurrency("en", 500, "JPY");
    expect(text).toContain("500");
    expect(text).not.toContain(".");
  });

  it("keeps two decimals for USD", () => {
    expect(formatCurrency("en", 1999, "USD")).toBe("$19.99");
  });
});
