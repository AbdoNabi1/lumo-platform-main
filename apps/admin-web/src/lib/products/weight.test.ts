import { describe, expect, it } from "vitest";
import { fromGrams, toGrams } from "./weight";

describe("toGrams", () => {
  it.each([
    ["250", "g", 250],
    ["1.5", "kg", 1500],
    ["0.001", "kg", 1],
    ["1", "lb", 454],
    ["2", "oz", 57],
    ["١٫٥", "kg", 1500],
    ["1,250", "g", 1250],
  ] as const)("reads %s %s as %i grams", (text, unit, grams) => {
    expect(toGrams(text, unit)).toBe(grams);
  });

  it.each(["", "abc", "-1", "1.2.3", "1e3"])("rejects %j", (text) => {
    expect(toGrams(text, "kg")).toBeNull();
  });
});

describe("fromGrams", () => {
  it.each([
    [250, "g", "250"],
    [1500, "kg", "1.5"],
    [2000, "kg", "2"],
    [1, "kg", "0.001"],
    [454, "lb", "1.001"],
    [57, "oz", "2.011"],
  ] as const)("shows %i g in %s as %s", (grams, unit, text) => {
    expect(fromGrams(grams, unit)).toBe(text);
  });

  it("is blank for no weight", () => {
    expect(fromGrams(null, "kg")).toBe("");
  });

  it("round-trips every whole gram through each unit, so saving an unchanged form changes nothing", () => {
    for (const unit of ["g", "kg", "lb", "oz"] as const) {
      for (const grams of [0, 1, 7, 28, 29, 250, 251, 453, 454, 999, 1000, 1234, 99_999]) {
        expect(toGrams(fromGrams(grams, unit), unit)).toBe(grams);
      }
    }
  });
});
