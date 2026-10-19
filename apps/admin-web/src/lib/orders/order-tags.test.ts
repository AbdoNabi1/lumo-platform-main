import { describe, expect, it } from "vitest";
import { characterCount, hasTag, parseTagFilter, splitTagInput } from "./order-tags";

describe("splitTagInput", () => {
  it("splits on commas, trims, collapses spaces and keeps the first spelling of a duplicate", () => {
    expect(splitTagInput(" VIP ,  urgent   order, vip,,")).toEqual({
      tags: ["VIP", "urgent order"],
      tooLong: [],
    });
  });

  it("sets aside a tag over 40 characters (emoji count as one)", () => {
    expect(splitTagInput(`ok, ${"x".repeat(41)}`)).toEqual({
      tags: ["ok"],
      tooLong: ["x".repeat(41)],
    });
    expect(splitTagInput("😀".repeat(40)).tags).toHaveLength(1);
  });
});

describe("hasTag / characterCount", () => {
  it("compares case- and space-insensitively", () => {
    expect(hasTag(["VIP Customer"], " vip   customer ")).toBe(true);
    expect(hasTag(["VIP"], "VIPs")).toBe(false);
  });

  it("counts code points", () => {
    expect(characterCount("😀ب")).toBe(2);
  });
});

describe("parseTagFilter (the list URL's ?tag=)", () => {
  it("reads a comma list or repeated params, at most 10 tags", () => {
    expect(parseTagFilter("vip,urgent")).toEqual(["vip", "urgent"]);
    expect(parseTagFilter(["vip", "urgent,gift"])).toEqual(["vip", "urgent", "gift"]);
    expect(parseTagFilter(undefined)).toEqual([]);
    expect(parseTagFilter(Array.from({ length: 12 }, (_, i) => `t${i}`).join(","))).toHaveLength(
      10,
    );
  });
});
