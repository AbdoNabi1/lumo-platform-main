import { describe, expect, it } from "vitest";
import {
  CHECKOUT_COUNTRIES,
  isCheckoutCountry,
  isValidPhone,
  normalizePhone,
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

describe("CHECKOUT_COUNTRIES", () => {
  it("is the twenty ISO codes, Egypt first", () => {
    expect(CHECKOUT_COUNTRIES).toHaveLength(20);
    expect(CHECKOUT_COUNTRIES[0]).toBe("EG");
    expect(isCheckoutCountry("EG")).toBe(true);
    expect(isCheckoutCountry("Egypt")).toBe(false);
  });
});
