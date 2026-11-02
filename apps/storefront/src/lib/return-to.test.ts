import { describe, expect, it } from "vitest";
import { safeReturnTo, stripNextInternals } from "./return-to";

/** The one shape a safe result may have: exactly `/`, or one `/` then neither `/` nor `\`. */
const SAFE_SHAPE = /^\/(?:$|[^/\\])/;

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
  // Review C-1: dot segments are resolved by the parse and can rebuild a leading `//`.
  it.each([
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/\r\n/evil.example", "/"],
    ["/\t\\evil.example", "/"],
    ["\t//evil.example", "/"],
    ["/.//evil.example", "/"],
    ["/..//evil.example", "/"],
    ["/%2e//evil.example", "/"],
    ["/%2e//evil.example/x", "/"],
    ["/%2E%2E//evil.example/x?y#z", "/"],
    ["/.\t//evil.example", "/"],
    ["/a/..//evil.example", "/"],
    ["/./\\evil.example", "/"],
    ["/.%2e//evil.example", "/"],
    ["//evil", "/"],
    ["/\t/evil", "/"],
    ["https://evil", "/"],
    ["javascript:", "/"],
    ["/%2F%2Fevil", "/%2F%2Fevil"], // encoded slashes stay one path segment on this shop
    ["/\u0000/evil.example", "/%00/evil.example"],
  ])("%j → %j (open redirect attempt)", (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it("keeps the path, query and hash, normalised", () => {
    expect(safeReturnTo("/collections/a/../b?page=2#grid")).toBe("/collections/b?page=2#grid");
  });

  it("drops Next's internal query parameters (review M-5)", () => {
    expect(safeReturnTo("/products/a?_rsc=1xyz")).toBe("/products/a");
    expect(safeReturnTo("/search?q=lamp&_rsc=1xyz&page=2")).toBe("/search?q=lamp&page=2");
    expect(safeReturnTo("/x?__nextDataReq=1&a=b")).toBe("/x?a=b");
    // Untouched when there is nothing to drop (no re-encoding of the query).
    expect(safeReturnTo("/search?q=a+b%20c")).toBe("/search?q=a+b%20c");
  });

  it("never returns to the password page itself (no loop after unlocking)", () => {
    expect(safeReturnTo("/password")).toBe("/");
    expect(safeReturnTo("/password?return_to=%2Fcart")).toBe("/");
    expect(safeReturnTo("/password/x")).toBe("/");
  });

  it("refuses anything that is not a string", () => {
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo(["/cart"])).toBe("/");
  });

  it("fuzz: every output is `/` or one `/` then a safe character, and stays on the shop", () => {
    const pieces = [
      "/",
      "//",
      "\\",
      ".",
      "..",
      "%2e",
      "%2E",
      "%2f",
      "%2F",
      "%5c",
      "%5C",
      "\t",
      "\n",
      "\r",
      " ",
      "a",
      "evil.example",
      "?",
      "#",
      ":",
      "@",
      "%00",
      "\u0000",
      "javascript:",
      "http:",
      "https://",
      "%09",
      "&",
      "=",
      "_rsc",
      "password",
      "%252e",
      "。",
      "．",
      "%",
    ];
    let seed = 0x9e3779b9;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 800; i += 1) {
      const length = 1 + Math.floor(random() * 8);
      let raw = random() < 0.8 ? "/" : "";
      for (let j = 0; j < length; j += 1) raw += pieces[Math.floor(random() * pieces.length)];
      const out = safeReturnTo(raw);
      expect(out, JSON.stringify(raw)).toMatch(SAFE_SHAPE);
      const resolved = new URL(out, "https://shop.example/password");
      expect(resolved.origin, JSON.stringify(raw)).toBe("https://shop.example");
      // A browser resolving the Location header must land on the same path.
      expect(`${resolved.pathname}${resolved.search}${resolved.hash}`, JSON.stringify(raw)).toBe(
        out,
      );
    }
  });
});

describe("stripNextInternals", () => {
  it("removes _rsc and __next* parameters in place, keeping everything else", () => {
    const url = new URL("https://a.example/x?_rsc=1&q=lamp&__nextLocale=en");
    stripNextInternals(url);
    expect(`${url.pathname}${url.search}`).toBe("/x?q=lamp");
  });
});
