import { describe, expect, it } from "vitest";
import { basisPointsToPercent, percentToBasisPoints } from "./rates";

describe("percentToBasisPoints", () => {
  it.each([
    ["14", 1400],
    ["14.5", 1450],
    ["14.25", 1425],
    ["0", 0],
    ["100", 10_000],
    ["0.01", 1],
    [" 14 ", 1400],
    ["14.0", 1400],
    ["١٤٫٥", 1450],
    ["14%", 1400],
  ])("reads %j as %i basis points", (text, basisPoints) => {
    expect(percentToBasisPoints(text)).toBe(basisPoints);
  });

  it.each(["", "abc", "-1", "100.01", "101", "14.375", "1e2", "14,5.5"])("refuses %j", (text) => {
    expect(percentToBasisPoints(text)).toBeNull();
  });

  it("works by string arithmetic, so 0.29 is 29 and never 28.999", () => {
    expect(percentToBasisPoints("0.29")).toBe(29);
    expect(percentToBasisPoints("1.15")).toBe(115);
  });
});

describe("basisPointsToPercent", () => {
  it.each([
    [1400, "14"],
    [1450, "14.5"],
    [1425, "14.25"],
    [0, "0"],
    [10_000, "100"],
    [1, "0.01"],
  ])("shows %i basis points as %s", (basisPoints, text) => {
    expect(basisPointsToPercent(basisPoints)).toBe(text);
  });

  it("round-trips every basis point", () => {
    for (const bp of [0, 1, 9, 10, 99, 100, 1437, 5000, 9999, 10_000]) {
      expect(percentToBasisPoints(basisPointsToPercent(bp))).toBe(bp);
    }
  });
});
