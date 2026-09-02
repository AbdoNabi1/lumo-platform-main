import { describe, expect, it } from "vitest";
import { BusinessRuleError } from "@platform/utils";
import { Money } from "./money";
import { ProductRef } from "./product-ref";

function usd(amountMinor: number): Money {
  const result = Money.create(amountMinor, "USD");
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("Money", () => {
  it("requires a non-negative integer and a 3-letter ISO currency", () => {
    expect(Money.create(1999, "USD").ok).toBe(true);
    expect(Money.create(0, "USD").ok).toBe(true);
    expect(Money.create(19.99, "USD").ok).toBe(false);
    expect(Money.create(-1, "USD").ok).toBe(false);
    expect(Money.create(100, "usd").ok).toBe(false);
  });

  it("adds, multiplies, and subtracts within a currency", () => {
    expect(usd(1999).plus(usd(1)).amountMinor).toBe(2000);
    expect(usd(1999).times(3).amountMinor).toBe(5997);
    expect(usd(2000).minus(usd(500)).amountMinor).toBe(1500);
    expect(Money.zero("USD").isZero()).toBe(true);
  });

  it("compares amounts within a currency", () => {
    expect(usd(2000).isGreaterThan(usd(1999))).toBe(true);
    expect(usd(1999).isGreaterThan(usd(2000))).toBe(false);
  });

  it("rejects mixed-currency arithmetic and negative results", () => {
    const eur = Money.create(100, "EUR");
    if (!eur.ok) throw new Error("invalid fixture");
    expect(() => usd(100).plus(eur.value)).toThrow(BusinessRuleError);
    expect(() => usd(100).minus(usd(101))).toThrow(BusinessRuleError);
    expect(() => usd(100).times(-1)).toThrow(BusinessRuleError);
  });
});

describe("ProductRef", () => {
  it("accepts a non-empty id and rejects blanks", () => {
    expect(ProductRef.create("product-1").ok).toBe(true);
    expect(ProductRef.create("   ").ok).toBe(false);
  });
});
