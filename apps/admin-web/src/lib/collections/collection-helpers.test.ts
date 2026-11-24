import { beforeEach, describe, expect, it } from "vitest";
import {
  MEMBERS_PAGE_SIZE,
  membersCursor,
  parseMembersPage,
  slugFromTitle,
} from "./collection-helpers";

beforeEach(() => {
  expect.hasAssertions();
});

describe("slugFromTitle", () => {
  it("lowercases, turns spaces into dashes and strips everything outside [a-z0-9-]", () => {
    expect(slugFromTitle("Summer  Sale 2026!")).toBe("summer-sale-2026");
    expect(slugFromTitle("Men's T-Shirts")).toBe("mens-t-shirts");
  });

  it("gives an empty handle for an Arabic title, which the merchant must type", () => {
    expect(slugFromTitle("مجموعة الصيف")).toBe("");
    expect(slugFromTitle("صيف")).toBe("");
  });
});

describe("parseMembersPage / membersCursor", () => {
  it("accepts integers >= 1 and sends everything else to page 1", () => {
    expect(parseMembersPage("1")).toBe(1);
    expect(parseMembersPage("2")).toBe(2);
    expect(parseMembersPage("37")).toBe(37);
    for (const bad of [undefined, "", "0", "-1", "2.5", "x", "1e2", " 2", ["2", "3"]]) {
      expect(parseMembersPage(bad), String(bad)).toBe(1);
    }
    expect(parseMembersPage("9".repeat(30))).toBe(1);
  });

  it("derives the cursor as the index of the previous page's last member", () => {
    expect(MEMBERS_PAGE_SIZE).toBe(50);
    expect(membersCursor(1)).toBeUndefined();
    expect(membersCursor(2)).toBe("49");
    expect(membersCursor(3)).toBe("99");
  });
});
