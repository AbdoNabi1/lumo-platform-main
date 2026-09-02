import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@platform/types";
import { ValidationError } from "@platform/utils";
import { Guard } from "./guard";

describe("Guard", () => {
  it("passes valid values", () => {
    expect(isOk(Guard.againstNullOrUndefined("x", "name"))).toBe(true);
    expect(isOk(Guard.againstEmpty("abc", "name"))).toBe(true);
    expect(isOk(Guard.againstEmpty([1], "items"))).toBe(true);
    expect(isOk(Guard.againstNegative(0, "qty"))).toBe(true);
    expect(isOk(Guard.againstOutOfRange(5, 1, 10, "age"))).toBe(true);
  });

  it("fails invalid values with a ValidationError", () => {
    const missing = Guard.againstNullOrUndefined(undefined, "name");
    expect(isErr(missing)).toBe(true);
    if (isErr(missing)) {
      expect(missing.error).toBeInstanceOf(ValidationError);
      expect(missing.error.fields[0]?.field).toBe("name");
    }
    expect(isErr(Guard.againstEmpty("   ", "name"))).toBe(true);
    expect(isErr(Guard.againstNegative(-1, "qty"))).toBe(true);
    expect(isErr(Guard.againstOutOfRange(99, 1, 10, "age"))).toBe(true);
  });

  it("combines results and aggregates field issues", () => {
    const combined = Guard.combine([
      Guard.againstNullOrUndefined(undefined, "name"),
      Guard.againstNegative(-1, "qty"),
      Guard.againstEmpty("ok", "label"),
    ]);
    expect(isErr(combined)).toBe(true);
    if (isErr(combined)) {
      expect(combined.error.fields).toHaveLength(2);
    }
  });

  it("combine succeeds when all results pass", () => {
    expect(isOk(Guard.combine([Guard.againstNegative(1, "a")]))).toBe(true);
  });
});
