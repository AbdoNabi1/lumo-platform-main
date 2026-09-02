import { describe, expect, it } from "vitest";
import {
  COMPONENT_LIFECYCLE_TRANSITIONS,
  componentAdvanceableStatusesFrom,
} from "./component-library-lifecycle";

describe("componentAdvanceableStatusesFrom", () => {
  it("returns every allowed target from draft", () => {
    expect(componentAdvanceableStatusesFrom("draft")).toEqual(["published", "archived"]);
  });

  it("returns every allowed target from published", () => {
    expect(componentAdvanceableStatusesFrom("published")).toEqual(["deprecated", "archived"]);
  });

  it("returns every allowed target from deprecated", () => {
    expect(componentAdvanceableStatusesFrom("deprecated")).toEqual(["archived"]);
  });

  it("returns an empty array for the terminal archived status", () => {
    expect(componentAdvanceableStatusesFrom("archived")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(componentAdvanceableStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("matches the table's own keys", () => {
    expect(Object.keys(COMPONENT_LIFECYCLE_TRANSITIONS)).toEqual([
      "draft",
      "published",
      "deprecated",
      "archived",
    ]);
  });
});
