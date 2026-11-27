import { describe, expect, it } from "vitest";
import { formatZonedDate, isoToZoned, safeZone, zoneLabel, zonedToIso } from "./zoned-time";

describe("zonedToIso", () => {
  it("reads the wall clock in the store's zone, not the machine's", () => {
    expect(zonedToIso("2026-10-16", "14:30", "Asia/Dubai")).toBe("2026-10-16T10:30:00.000Z");
    expect(zonedToIso("2026-10-16", "14:30", "UTC")).toBe("2026-10-16T14:30:00.000Z");
  });

  it("rejects dates and times that do not exist", () => {
    expect(zonedToIso("2026-02-30", "10:00", "UTC")).toBeNull();
    expect(zonedToIso("2026-10-16", "24:10", "UTC")).toBeNull();
    expect(zonedToIso("", "10:00", "UTC")).toBeNull();
    expect(zonedToIso("2026-10-16", "", "UTC")).toBeNull();
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(safeZone("Not/AZone")).toBe("UTC");
    expect(zonedToIso("2026-10-16", "08:00", "Not/AZone")).toBe("2026-10-16T08:00:00.000Z");
  });
});

describe("isoToZoned", () => {
  it("is the inverse of zonedToIso", () => {
    expect(isoToZoned("2026-10-16T10:30:00.000Z", "Asia/Dubai")).toEqual({
      date: "2026-10-16",
      time: "14:30",
    });
    expect(isoToZoned("2026-12-31T23:05:00.000Z", "UTC")).toEqual({
      date: "2026-12-31",
      time: "23:05",
    });
  });
});

describe("zoneLabel / formatZonedDate", () => {
  it("names the zone and formats a date in it", () => {
    expect(zoneLabel("UTC", "en")).toMatch(/UTC/);
    expect(formatZonedDate("2026-10-16T22:30:00.000Z", "en", "Asia/Dubai")).toMatch(/Oct 17/);
  });
});
