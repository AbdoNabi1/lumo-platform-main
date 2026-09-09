import { describe, expect, it } from "vitest";
import { FinanceMapper } from "./finance.mappers";

/**
 * Stands in for a `Prisma.Decimal` instance without adding a `decimal.js` dependency to this
 * package just for a test double — `Number(x)` only needs `valueOf()`/`toString()` to exist,
 * which is all a real `Prisma.Decimal` (decimal.js underneath) and this fake share.
 */
function fakeDecimal(value: string): { toString(): string; valueOf(): string } {
  return { toString: () => value, valueOf: () => value };
}

describe("FinanceMapper.exchangeRateToDomain (WP-11, F-07 — Float -> Decimal)", () => {
  it("converts a Prisma.Decimal-shaped rate to an exact number", () => {
    // Simulates exactly what a real query against the Decimal(18,8) column returns — an object
    // with decimal.js's `toString`/`valueOf`, not a plain JS number.
    const rate = FinanceMapper.exchangeRateToDomain({
      id: "rate-1",
      baseCurrency: "USD",
      quoteCurrency: "SAR",
      rate: fakeDecimal("3.75000000"),
      effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(rate.rate).toBe(3.75);
  });

  it("preserves a rate with 8 fractional digits exactly (Decimal(18,8)'s full precision)", () => {
    const rate = FinanceMapper.exchangeRateToDomain({
      id: "rate-1",
      baseCurrency: "USD",
      quoteCurrency: "SAR",
      rate: fakeDecimal("3.75123456"),
      effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(rate.rate).toBe(3.75123456);
  });
});
