import { describe, expect, it } from "vitest";
import { pickLocation } from "./pick-location";

describe("pickLocation", () => {
  it("picks the location with the most stock and reports that it covers the quantity", () => {
    const levels = [
      { locationId: "a", available: 3 },
      { locationId: "b", available: 7 },
    ];

    expect(pickLocation(levels, 5)).toEqual({ locationId: "b", available: 7, covers: true });
  });

  it("still picks the largest location when it cannot cover the quantity", () => {
    const levels = [
      { locationId: "a", available: 3 },
      { locationId: "b", available: 7 },
    ];

    expect(pickLocation(levels, 9)).toEqual({ locationId: "b", available: 7, covers: false });
  });

  it("breaks a tie by input order", () => {
    const levels = [
      { locationId: "a", available: 4 },
      { locationId: "b", available: 4 },
    ];

    expect(pickLocation(levels, 2)?.locationId).toBe("a");
  });

  it("returns null when there is no location", () => {
    expect(pickLocation([], 1)).toBeNull();
  });
});
