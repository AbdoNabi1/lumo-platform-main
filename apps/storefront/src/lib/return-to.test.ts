import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo (spec 1.5)", () => {
  it.each([
    ["/products/a?x=1", "/products/a?x=1"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example/", "/"],
    ["javascript:alert(1)", "/"],
    ["products", "/"],
    ["", "/"],
    [null, "/"],
    ["/%0d%0aSet-Cookie:x", "/%0d%0aSet-Cookie:x"],
  ])("%j → %j", (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  // Preflight 17: browsers drop tab and newline from a URL, so these become `//evil.example`.
  it.each([
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/\r\n/evil.example", "/"],
    ["/\t\\evil.example", "/"],
    ["\t//evil.example", "/"],
    ["/\u0000/evil.example", "/%00/evil.example"],
  ])("%j → %j (open redirect attempt)", (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it("keeps the path, query and hash, normalised", () => {
    expect(safeReturnTo("/collections/a/../b?page=2#grid")).toBe("/collections/b?page=2#grid");
  });

  it("never returns to the password page itself (no loop after unlocking)", () => {
    expect(safeReturnTo("/password")).toBe("/");
    expect(safeReturnTo("/password?return_to=%2Fcart")).toBe("/");
  });

  it("refuses anything that is not a string", () => {
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo(["/cart"])).toBe("/");
  });
});
