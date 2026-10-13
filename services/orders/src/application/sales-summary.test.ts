import { describe, expect, it } from "vitest";
import {
  averageOrderValueMinor,
  enumerateDays,
  previousSalesRange,
  rankTopProducts,
  validateSalesRange,
} from "./sales-summary";

describe("validateSalesRange", () => {
  it("accepts a one-day and a 366-day range", () => {
    expect(validateSalesRange("2026-10-12", "2026-10-13")).toBeNull();
    expect(validateSalesRange("2025-10-12", "2026-10-13")).toBeNull();
  });

  it.each([
    ["a malformed start", "12/10/2026", "2026-10-13"],
    ["a malformed end", "2026-10-12", "2026-10-13T00:00:00Z"],
    ["an impossible date", "2026-02-30", "2026-03-05"],
    ["an empty range", "2026-10-12", "2026-10-12"],
    ["an end before the start", "2026-10-13", "2026-10-12"],
    ["a range longer than 366 days", "2025-10-11", "2026-10-13"],
  ])("refuses %s", (_label, from, to) => {
    expect(validateSalesRange(from, to)).toEqual(expect.any(String));
  });
});

describe("enumerateDays", () => {
  it("lists every day from `from` up to but not including `to`, across a month end", () => {
    expect(enumerateDays("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });
});

describe("averageOrderValueMinor", () => {
  it("is 0 when there are no orders", () => {
    expect(averageOrderValueMinor(0, 0)).toBe(0);
  });

  it("rounds half up", () => {
    expect(averageOrderValueMinor(10001, 2)).toBe(5001);
    expect(averageOrderValueMinor(10000, 3)).toBe(3333);
  });
});

describe("rankTopProducts", () => {
  const row = (name: string, quantity: number, salesMinor: number) => ({
    productRef: name.toLowerCase(),
    variantRef: null,
    name,
    variantTitle: null,
    quantity,
    salesMinor,
  });

  it("orders by quantity, then sales, then name, and keeps the top five", () => {
    const ranked = rankTopProducts([
      row("Charlie", 3, 100),
      row("Alpha", 3, 100),
      row("Bravo", 3, 200),
      row("Delta", 9, 1),
      row("Echo", 1, 1),
      row("Foxtrot", 1, 1),
    ]);

    expect(ranked.map((product) => product.name)).toEqual([
      "Delta",
      "Bravo",
      "Alpha",
      "Charlie",
      "Echo",
    ]);
  });
});

describe("previousSalesRange", () => {
  it("is the equal-length range that ends where the current one starts", () => {
    expect(previousSalesRange("2026-10-06", "2026-10-13")).toEqual({
      from: "2026-09-29",
      to: "2026-10-06",
    });
  });

  it("is yesterday for today, and crosses a month and year end", () => {
    expect(previousSalesRange("2026-10-13", "2026-10-14")).toEqual({
      from: "2026-10-12",
      to: "2026-10-13",
    });
    expect(previousSalesRange("2026-01-01", "2026-01-04")).toEqual({
      from: "2025-12-29",
      to: "2026-01-01",
    });
  });
});
