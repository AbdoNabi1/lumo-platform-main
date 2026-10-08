import { describe, expect, it } from "vitest";
import type { Product } from "@platform/catalog";
import { variantOf } from "./variant-of";

function productWith(...ids: string[]): Product {
  return {
    variants: ids.map((id) => ({ id: { toString: () => id } })),
  } as unknown as Product;
}

describe("variantOf (Plan 2A rule, shared by checkout, orders and the cart routes)", () => {
  it("returns the named variant", () => {
    const product = productWith("v-m", "v-l");
    expect(variantOf(product, "v-l")?.id.toString()).toBe("v-l");
  });

  it("returns nothing for a named variant the product does not have", () => {
    expect(variantOf(productWith("v-m", "v-l"), "v-xl")).toBeUndefined();
  });

  it("with none named, returns the product's only variant", () => {
    expect(variantOf(productWith("v-only"), undefined)?.id.toString()).toBe("v-only");
    expect(variantOf(productWith("v-only"), null)?.id.toString()).toBe("v-only");
  });

  it("with none named and several variants, never guesses", () => {
    expect(variantOf(productWith("v-m", "v-l"), undefined)).toBeUndefined();
    expect(variantOf(productWith("v-m", "v-l"), null)).toBeUndefined();
  });

  it("with none named and no variants, returns nothing", () => {
    expect(variantOf(productWith(), undefined)).toBeUndefined();
  });
});
