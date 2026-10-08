import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_LENGTH, ProductDetails, normalizeTags } from "./product-details";

describe("ProductDetails (Plan 2C-1)", () => {
  it("trims, and turns blank text into null", () => {
    const result = ProductDetails.create({
      description: "  Soft cotton.\nMachine wash.  ",
      productType: "   ",
      tags: [],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.description).toBe("Soft cotton.\nMachine wash.");
    expect(result.value.productType).toBeNull();
  });

  it("normalizes tags: trimmed, no blanks, case-insensitive duplicates dropped, first kept", () => {
    expect(normalizeTags([" Summer ", "summer", "", "SALE", "sale ", "Cotton"])).toEqual([
      "Summer",
      "SALE",
      "Cotton",
    ]);
  });

  it("rejects an over-long description and too many tags", () => {
    expect(
      ProductDetails.create({
        description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1),
        productType: null,
        tags: [],
      }).ok,
    ).toBe(false);
    expect(
      ProductDetails.create({
        description: null,
        productType: null,
        tags: Array.from({ length: 251 }, (_, i) => `t${i}`),
      }).ok,
    ).toBe(false);
  });
});
