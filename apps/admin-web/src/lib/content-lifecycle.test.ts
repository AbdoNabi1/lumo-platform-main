import { describe, expect, it } from "vitest";
import { CONTENT_LIFECYCLE_TRANSITIONS, contentAdvanceableStatusesFrom } from "./content-lifecycle";

describe("contentAdvanceableStatusesFrom", () => {
  it("returns every allowed target from draft", () => {
    expect(contentAdvanceableStatusesFrom("draft")).toEqual([
      "scheduled",
      "published",
      "archived",
    ]);
  });

  it("returns every allowed target from scheduled", () => {
    expect(contentAdvanceableStatusesFrom("scheduled")).toEqual(["published", "archived"]);
  });

  it("returns every allowed target from published", () => {
    expect(contentAdvanceableStatusesFrom("published")).toEqual(["archived"]);
  });

  it("returns an empty array for the terminal archived status", () => {
    expect(contentAdvanceableStatusesFrom("archived")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(contentAdvanceableStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("matches the table's own keys", () => {
    expect(Object.keys(CONTENT_LIFECYCLE_TRANSITIONS)).toEqual([
      "draft",
      "scheduled",
      "published",
      "archived",
    ]);
  });
});
