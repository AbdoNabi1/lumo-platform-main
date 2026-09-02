import { describe, expect, it } from "vitest";
import { THEME_LIFECYCLE_TRANSITIONS, themeAdvanceableStatusesFrom } from "./theme-lifecycle";

describe("themeAdvanceableStatusesFrom", () => {
  it("returns every allowed target from draft", () => {
    expect(themeAdvanceableStatusesFrom("draft")).toEqual(["active", "archived"]);
  });

  it("returns every allowed target from active", () => {
    expect(themeAdvanceableStatusesFrom("active")).toEqual(["archived"]);
  });

  it("returns an empty array for the terminal archived status", () => {
    expect(themeAdvanceableStatusesFrom("archived")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(themeAdvanceableStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("matches the table's own keys", () => {
    expect(Object.keys(THEME_LIFECYCLE_TRANSITIONS)).toEqual(["draft", "active", "archived"]);
  });
});
