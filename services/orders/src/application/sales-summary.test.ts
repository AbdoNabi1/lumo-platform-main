import { describe, expect, it } from "vitest";
import {
  averageOrderValueMinor,
  enumerateDays,
  isSalesRangePreset,
  localDay,
  previousPresetRange,
  previousSalesRange,
  rankTopProducts,
  resolveSalesRange,
  SALES_RANGE_PRESETS,
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

describe("previousPresetRange", () => {
  it("compares this month with the same days of last month, like Shopify's month to date", () => {
    expect(previousPresetRange("month", "2026-10-13")).toEqual({
      from: "2026-09-01",
      to: "2026-09-14",
    });
    expect(previousPresetRange("month", "2026-01-05")).toEqual({
      from: "2025-12-01",
      to: "2025-12-06",
    });
  });

  it("stops at the end of a shorter last month", () => {
    expect(previousPresetRange("month", "2026-03-30")).toEqual({
      from: "2026-02-01",
      to: "2026-03-01",
    });
    expect(previousPresetRange("month", "2026-10-31")).toEqual({
      from: "2026-09-01",
      to: "2026-10-01",
    });
  });

  it("is the equal-length range just before for every other preset", () => {
    expect(previousPresetRange("7d", "2026-10-13")).toEqual({
      from: "2026-09-30",
      to: "2026-10-07",
    });
    expect(previousPresetRange("today", "2026-10-13")).toEqual({
      from: "2026-10-12",
      to: "2026-10-13",
    });
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

describe("resolveSalesRange", () => {
  // Wednesday 2026-10-14
  it.each([
    ["today", { from: "2026-10-14", to: "2026-10-15" }],
    ["yesterday", { from: "2026-10-13", to: "2026-10-14" }],
    ["7d", { from: "2026-10-08", to: "2026-10-15" }],
    ["30d", { from: "2026-09-15", to: "2026-10-15" }],
    ["month", { from: "2026-10-01", to: "2026-10-15" }],
  ] as const)("%s ends today, in the shop's own calendar", (preset, expected) => {
    expect(resolveSalesRange(preset, "2026-10-14")).toEqual(expected);
  });

  it("crosses a month and year end", () => {
    expect(resolveSalesRange("today", "2026-12-31")).toEqual({
      from: "2026-12-31",
      to: "2027-01-01",
    });
    expect(resolveSalesRange("7d", "2026-01-03")).toEqual({ from: "2025-12-28", to: "2026-01-04" });
    expect(resolveSalesRange("month", "2026-03-01")).toEqual({
      from: "2026-03-01",
      to: "2026-03-02",
    });
  });

  it("every preset is a valid range", () => {
    for (const preset of SALES_RANGE_PRESETS) {
      const { from, to } = resolveSalesRange(preset, "2026-10-14");
      expect(validateSalesRange(from, to)).toBeNull();
    }
  });
});

describe("localDay", () => {
  it("is the calendar day in the zone: 22:30 UTC on Oct 12 is already Oct 13 in Cairo", () => {
    expect(localDay(new Date("2026-10-12T22:30:00Z"), "Africa/Cairo")).toBe("2026-10-13");
    expect(localDay(new Date("2026-10-12T22:30:00Z"), "UTC")).toBe("2026-10-12");
  });
});

describe("isSalesRangePreset", () => {
  it("knows the five presets and nothing else", () => {
    expect(SALES_RANGE_PRESETS.every((preset) => isSalesRangePreset(preset))).toBe(true);
    expect(isSalesRangePreset("90d")).toBe(false);
    expect(isSalesRangePreset("")).toBe(false);
  });
});
