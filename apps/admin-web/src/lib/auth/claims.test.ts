import { describe, expect, it } from "vitest";
import { readRolesClaim, readStringClaim, readTokenClaim } from "./claims";

describe("readTokenClaim", () => {
  it("reads a top-level claim", () => {
    expect(readTokenClaim({ roles: ["admin"] }, "roles")).toEqual(["admin"]);
  });

  it("falls back to `ext` — the shape Hydra actually issues", () => {
    expect(readTokenClaim({ ext: { roles: ["admin"] } }, "roles")).toEqual(["admin"]);
  });

  it("prefers top level when both are present", () => {
    expect(readTokenClaim({ roles: ["admin"], ext: { roles: ["viewer"] } }, "roles")).toEqual([
      "admin",
    ]);
  });

  it("returns undefined when neither carries the claim", () => {
    expect(readTokenClaim({ sub: "x" }, "roles")).toBeUndefined();
  });

  it.each([
    ["a string", "nonsense"],
    ["null", null],
    ["an array", ["a"]],
    ["a number", 7],
  ])("ignores a non-object `ext` (%s) rather than throwing", (_label, ext) => {
    expect(readTokenClaim({ ext }, "roles")).toBeUndefined();
  });
});

describe("readRolesClaim", () => {
  it("returns the roles from `ext`", () => {
    expect(readRolesClaim({ ext: { roles: ["admin", "operator"] } })).toEqual([
      "admin",
      "operator",
    ]);
  });

  it("drops non-string entries instead of trusting the array wholesale", () => {
    expect(readRolesClaim({ roles: ["admin", 3, null, "viewer"] })).toEqual(["admin", "viewer"]);
  });

  it("returns [] when the claim is absent or not an array", () => {
    expect(readRolesClaim({})).toEqual([]);
    expect(readRolesClaim({ roles: "admin" })).toEqual([]);
  });
});

describe("readStringClaim", () => {
  it("reads a string from `ext`", () => {
    expect(readStringClaim({ ext: { kind: "staff" } }, "kind")).toBe("staff");
  });

  it("returns undefined for a non-string value", () => {
    expect(readStringClaim({ kind: 42 }, "kind")).toBeUndefined();
  });
});
