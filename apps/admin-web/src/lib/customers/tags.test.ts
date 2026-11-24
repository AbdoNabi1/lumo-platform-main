import { beforeEach, describe, expect, it } from "vitest";
import { mergeTags, normalizeTag, sameTags, splitTags, tagKeyOf } from "./tags";

beforeEach(() => {
  expect.hasAssertions();
});

describe("splitTags", () => {
  it("splits on Latin and Arabic commas, trimming and dropping blanks", () => {
    expect(splitTags(" VIP, Cairo،  gold ,, ")).toEqual(["VIP", "Cairo", "gold"]);
  });

  it("returns nothing for blank text", () => {
    expect(splitTags("  ")).toEqual([]);
    expect(splitTags(",,")).toEqual([]);
  });
});

describe("mergeTags", () => {
  it("de-duplicates case-insensitively, keeping the first spelling and order", () => {
    expect(mergeTags(["VIP"], ["vip", "Cairo", "CAIRO", "gold"])).toEqual(["VIP", "Cairo", "gold"]);
  });

  it("de-duplicates inside the existing list too", () => {
    expect(mergeTags(["a", "A"], [])).toEqual(["a"]);
  });
});

describe("sameTags", () => {
  it("ignores order and case", () => {
    expect(sameTags(["VIP", "Cairo"], ["cairo", "vip"])).toBe(true);
  });

  it("notices an added, removed or different tag", () => {
    expect(sameTags(["VIP"], ["VIP", "Cairo"])).toBe(false);
    expect(sameTags(["VIP", "Cairo"], ["VIP", "Giza"])).toBe(false);
  });
});

describe("Identity-aligned normalisation", () => {
  it("normalizes to NFC, collapses internal whitespace and trims", () => {
    expect(normalizeTag("  new 	  tag ")).toBe("new tag");
    expect(normalizeTag("café")).toBe("café");
    expect(tagKeyOf("New  TAG")).toBe("new tag");
  });

  it("splitTags returns the normalized spelling", () => {
    expect(splitTags("new  tag, café")).toEqual(["new tag", "café"]);
  });

  it("mergeTags and sameTags treat spacing and NFC variants as the same tag", () => {
    expect(mergeTags(["new tag", "café"], ["new  tag", "café", "gold"])).toEqual([
      "new tag",
      "café",
      "gold",
    ]);
    expect(sameTags(["new  tag"], ["New Tag"])).toBe(true);
    expect(sameTags(["café"], ["café"])).toBe(true);
  });
});
