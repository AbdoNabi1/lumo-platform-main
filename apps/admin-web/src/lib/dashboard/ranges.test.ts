import { describe, expect, it } from "vitest";
import { DASHBOARD_RANGES, DEFAULT_RANGE, parseRange, rangeHref } from "./ranges";

describe("dashboard ranges", () => {
  it("offers today, yesterday, 7 days, 30 days and this month, in that order", () => {
    expect(DASHBOARD_RANGES).toEqual(["today", "yesterday", "7d", "30d", "month"]);
  });

  it("defaults to the last 7 days", () => {
    expect(DEFAULT_RANGE).toBe("7d");
    expect(parseRange(undefined)).toBe("7d");
  });

  it.each(DASHBOARD_RANGES)("reads ?range=%s from the URL", (range) => {
    expect(parseRange(range)).toBe(range);
  });

  it("falls back to the default for anything it does not know, rather than failing the page", () => {
    expect(parseRange("90d")).toBe("7d");
    expect(parseRange("")).toBe("7d");
    expect(parseRange(["30d", "today"])).toBe("7d");
  });

  it("puts the range in the URL so a reload keeps it", () => {
    expect(rangeHref("30d")).toBe("/?range=30d");
    expect(rangeHref("today")).toBe("/?range=today");
  });
});
