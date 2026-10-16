import { describe, expect, it } from "vitest";
import { changeBetween, trendPoints } from "./change";

describe("changeBetween (the badge on a KPI card)", () => {
  it("is the fraction up when the figure grew", () => {
    expect(changeBetween(150, 100)).toEqual({ kind: "percent", fraction: 0.5 });
  });

  it("is the fraction down when the figure shrank", () => {
    expect(changeBetween(75, 100)).toEqual({ kind: "percent", fraction: -0.25 });
  });

  it("is 0% when nothing changed", () => {
    expect(changeBetween(100, 100)).toEqual({ kind: "percent", fraction: 0 });
  });

  it("is none (a dash) when both periods are 0", () => {
    expect(changeBetween(0, 0)).toEqual({ kind: "none" });
  });

  it("is new when only the current period has anything", () => {
    expect(changeBetween(1, 0)).toEqual({ kind: "new" });
    expect(changeBetween(12_345, 0)).toEqual({ kind: "new" });
  });

  it("is minus 100% when the current period fell to 0", () => {
    expect(changeBetween(0, 40)).toEqual({ kind: "percent", fraction: -1 });
  });
});

describe("trendPoints (a sparkline from the daily figures)", () => {
  it("scales the figures to 0..1, oldest first", () => {
    expect(trendPoints([0, 50, 100])).toEqual([0, 0.5, 1]);
  });

  it("is a flat line at the bottom when every day is 0: zeros are shown as zeros", () => {
    expect(trendPoints([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("has nothing to draw for fewer than two days", () => {
    expect(trendPoints([])).toEqual([]);
    expect(trendPoints([5])).toEqual([]);
  });
});
