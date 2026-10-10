import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDelta,
  formatLongDate,
  formatNumber,
  formatPercent,
  formatRelativeMinutes,
  orderDateParts,
} from "./format";

/**
 * Formatting is where "supports Arabic" stops being a layout claim: these assert that the
 * Arabic surface gets locale-formatted output rather than English strings in a flipped
 * layout, and that money is treated as minor units throughout.
 */

describe("formatCurrency", () => {
  it("treats the amount as minor units", () => {
    expect(formatCurrency("en", 12_834_000, "USD")).toBe("$128,340.00");
  });

  it("produces different output per locale", () => {
    expect(formatCurrency("ar", 12_834_000, "USD")).not.toBe(
      formatCurrency("en", 12_834_000, "USD"),
    );
  });

  it("uses the currency's own minor-unit exponent (Plan 2B-1)", () => {
    expect(formatCurrency("en", 15050, "EGP")).toContain("150.50");
    expect(formatCurrency("en", 12345, "KWD")).toContain("12.345");
    const yen = formatCurrency("en", 500, "JPY");
    expect(yen).toContain("500");
    expect(yen).not.toContain(".");
  });
});

describe("formatCurrencyCompact", () => {
  it("scales by the currency's own exponent, not a fixed 100", () => {
    // 80,000.000 KWD and 80,000 JPY both read as 80K; a fixed /100 would read 800K and 800.
    expect(formatCurrencyCompact("en", 80_000_000, "KWD")).toContain("80K");
    expect(formatCurrencyCompact("en", 80_000, "JPY")).toContain("80K");
    expect(formatCurrencyCompact("en", 8_000_000, "USD")).toContain("80K");
  });
});

describe("formatPercent", () => {
  it("renders a fraction as a percentage", () => {
    expect(formatPercent("en", 0.0234)).toBe("2.34%");
  });

  it("honours the requested precision", () => {
    expect(formatPercent("en", 0.564, 1)).toBe("56.4%");
  });
});

describe("formatDelta", () => {
  it("always shows the sign, so direction never rests on colour alone", () => {
    expect(formatDelta("en", 0.182)).toBe("+18.2%");
    expect(formatDelta("en", -0.012)).toMatch(/^[-−]1\.2%$/);
  });
});

describe("formatNumber", () => {
  it("groups thousands", () => {
    expect(formatNumber("en", 1482)).toBe("1,482");
  });
});

describe("formatRelativeMinutes", () => {
  it("picks the largest unit that fits", () => {
    expect(formatRelativeMinutes("en", 2)).toMatch(/minute/);
    expect(formatRelativeMinutes("en", 60)).toMatch(/hour/);
    expect(formatRelativeMinutes("en", 60 * 24 * 3)).toMatch(/day/);
  });

  it("localises the phrasing", () => {
    expect(formatRelativeMinutes("ar", 2)).not.toBe(formatRelativeMinutes("en", 2));
  });
});

describe("orderDateParts (Plan 3B: Shopify-style relative order dates)", () => {
  // Built from LOCAL calendar fields, because "today" is the runtime's own calendar day, the same
  // calendar Intl formats in.
  const at = (y: number, m: number, d: number, h: number, min: number) =>
    new Date(y, m - 1, d, h, min).toISOString();
  const now = new Date(2026, 9, 9, 21, 0); // 9 Oct 2026, 9:00 pm

  it("says today for an order placed earlier the same day", () => {
    const parts = orderDateParts("en", at(2026, 10, 9, 20, 27), now);
    expect(parts.when).toBe("today");
    expect(parts.time).toBe("8:27 pm");
  });

  it("says yesterday for the previous calendar day, even a few minutes before midnight", () => {
    expect(orderDateParts("en", at(2026, 10, 8, 23, 58), now).when).toBe("yesterday");
    expect(orderDateParts("en", at(2026, 10, 8, 0, 5), now).when).toBe("yesterday");
  });

  it("gives the short date for anything older", () => {
    const parts = orderDateParts("en", at(2026, 10, 7, 9, 5), now);
    expect(parts.when).toBe("other");
    expect(parts.date).toBe("Oct 7");
    expect(parts.time).toBe("9:05 am");
  });

  it("treats a date in the future (clock skew) as today rather than inventing a label", () => {
    expect(orderDateParts("en", at(2026, 10, 9, 23, 59), now).when).toBe("today");
  });

  it("localises the time and the date for Arabic", () => {
    const parts = orderDateParts("ar", at(2026, 10, 7, 20, 27), now);
    expect(parts.when).toBe("other");
    expect(parts.time).not.toBe("8:27 pm");
    expect(parts.time).toContain("م"); // the Arabic day period
    expect(parts.date).not.toBe("Oct 7");
  });

  it("carries the full date and time for the tooltip", () => {
    const parts = orderDateParts("en", at(2026, 10, 7, 9, 5), now);
    expect(parts.full).toContain("Oct 7, 2026");
    expect(parts.full).toContain("9:05");
  });
});

describe("formatLongDate (Plan 3B: the order page header)", () => {
  it("spells out the month, day and year in the page locale", () => {
    const iso = new Date(2026, 9, 9, 20, 27).toISOString();

    expect(formatLongDate("en", iso)).toBe("October 9, 2026");
    expect(formatLongDate("ar", iso)).not.toBe("October 9, 2026");
    expect(formatLongDate("ar", iso)).toContain("أكتوبر");
  });
});
