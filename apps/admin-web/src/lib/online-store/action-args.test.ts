import { describe, expect, it } from "vitest";
import { isVersion, localizedOf } from "./action-args";

describe("action argument checks", () => {
  it("isVersion accepts whole numbers from zero", () => {
    expect([0, 1, 42].every(isVersion)).toBe(true);
    for (const bad of [-1, 1.5, NaN, "1", null, undefined]) expect(isVersion(bad)).toBe(false);
  });

  it("localizedOf keeps string locales and refuses everything else", () => {
    expect(localizedOf({ ar: "أ", en: "a" })).toEqual({ ar: "أ", en: "a" });
    expect(localizedOf({ en: "a" })).toEqual({ en: "a" });
    expect(localizedOf({})).toEqual({});
    for (const bad of [null, undefined, "x", [], { en: 1 }, { ar: null }, { fr: "x" }]) {
      expect(localizedOf(bad)).toBeNull();
    }
  });
});
