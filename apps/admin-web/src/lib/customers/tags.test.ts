import { beforeEach, describe, expect, it } from "vitest";
import { mergeTags, sameTags, splitTags } from "./tags";

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
