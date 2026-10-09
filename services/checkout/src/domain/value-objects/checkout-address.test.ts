import { describe, expect, it } from "vitest";
import { CheckoutAddress, type CheckoutAddressInput } from "./checkout-address";

const base: CheckoutAddressInput = {
  line1: "1 Main St",
  city: "Cairo",
  postalCode: "11511",
  country: "EG",
};

function create(extra: Partial<CheckoutAddressInput> = {}) {
  return CheckoutAddress.create({ ...base, ...extra });
}

describe("CheckoutAddress — recipient name and phone (Plan 3A)", () => {
  it("normalizes Arabic-Indic digits and strips spaces from the phone", () => {
    const result = create({ phone: "٠١٠ ١٢٣٤ ٥٦٧٨" });
    expect(result.ok && result.value.phone).toBe("01012345678");
  });

  it("normalizes Persian digits", () => {
    const result = create({ phone: "۰۱۰۱۲۳۴۵۶۷۸" });
    expect(result.ok && result.value.phone).toBe("01012345678");
  });

  it("keeps a leading + and strips dashes and brackets", () => {
    const result = create({ phone: "+20 10-1234-5678" });
    expect(result.ok && result.value.phone).toBe("+201012345678");
    const bracketed = create({ phone: "(010) 1234 5678" });
    expect(bracketed.ok && bracketed.value.phone).toBe("01012345678");
  });

  it("rejects a phone that is not 7 to 15 digits", () => {
    for (const phone of ["12ab", "123456", "1234567890123456", "++201012345678"]) {
      const result = create({ phone });
      expect(result.ok, phone).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.map((issue) => issue.field)).toContain("phone");
      }
    }
  });

  it("leaves the phone absent when none is given", () => {
    const result = create();
    expect(result.ok && result.value.phone).toBeUndefined();
    expect(result.ok && result.value.name).toBeUndefined();
  });

  it("trims the name and rejects an empty or 121-character one", () => {
    const named = create({ name: "  Mona Ali  " });
    expect(named.ok && named.value.name).toBe("Mona Ali");

    for (const name of ["   ", "x".repeat(121)]) {
      const result = create({ name });
      expect(result.ok, name.length.toString()).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.map((issue) => issue.field)).toContain("name");
      }
    }
    expect(create({ name: "x".repeat(120) }).ok).toBe(true);
  });
});

describe("CheckoutAddress — postal code is optional (Plan 3A)", () => {
  it("accepts an empty postal code and stores an empty string", () => {
    const result = create({ postalCode: "" });
    expect(result.ok && result.value.postalCode).toBe("");
  });

  it("still requires line1, city and country", () => {
    for (const field of ["line1", "city", "country"] as const) {
      const result = create({ [field]: " " });
      expect(result.ok, field).toBe(false);
    }
  });
});
