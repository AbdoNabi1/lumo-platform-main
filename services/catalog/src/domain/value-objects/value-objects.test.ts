import { describe, expect, it } from "vitest";
import { Sku } from "./sku";
import { Slug } from "./slug";

describe("Sku", () => {
  it("accepts a non-empty value and rejects blank", () => {
    expect(Sku.create("ABC-1").ok).toBe(true);
    expect(Sku.create("   ").ok).toBe(false);
  });
});

describe("Slug", () => {
  it("accepts lower kebab-case and rejects other shapes", () => {
    expect(Slug.create("red-wagon").ok).toBe(true);
    expect(Slug.create("Red Wagon").ok).toBe(false);
    expect(Slug.create("-leading").ok).toBe(false);
  });
});
