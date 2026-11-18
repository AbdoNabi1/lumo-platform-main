import { describe, expect, it } from "vitest";
import {
  isCalendarDay,
  nextDay,
  startOfZonedDay,
  zonedDateTimeLabel,
  zonedDay,
} from "./zoned-time";

describe("shop time-zone helpers (order export)", () => {
  it("prints an instant as the shop's local date and time", () => {
    expect(zonedDateTimeLabel("2026-10-18T09:05:00.000Z", "Asia/Riyadh")).toBe("2026-10-18 12:05");
    expect(zonedDateTimeLabel("2026-10-18T21:30:00.000Z", "Asia/Riyadh")).toBe("2026-10-19 00:30");
  });

  it("names the shop's calendar day of an instant", () => {
    expect(zonedDay(new Date("2026-10-17T22:30:00.000Z"), "Asia/Riyadh")).toBe("2026-10-18");
  });

  it("finds the instant a shop-local day starts", () => {
    expect(startOfZonedDay("2026-10-18", "Asia/Riyadh").toISOString()).toBe(
      "2026-10-17T21:00:00.000Z",
    );
    expect(startOfZonedDay("2026-10-18", "UTC").toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });

  it("steps to the next calendar day across months and years", () => {
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("accepts only real yyyy-mm-dd days", () => {
    expect(isCalendarDay("2026-02-28")).toBe(true);
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2026-2-3")).toBe(false);
    expect(isCalendarDay("")).toBe(false);
  });
});
