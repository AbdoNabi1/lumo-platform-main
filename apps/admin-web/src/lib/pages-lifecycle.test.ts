import { describe, expect, it } from "vitest";
import { PAGE_LIFECYCLE_TRANSITIONS, pageAdvanceableStatusesFrom, templateCanArchive } from "./pages-lifecycle";

describe("pageAdvanceableStatusesFrom", () => {
  it("returns every allowed target from draft", () => {
    expect(pageAdvanceableStatusesFrom("draft")).toEqual(["published", "archived"]);
  });

  it("returns every allowed target from published", () => {
    expect(pageAdvanceableStatusesFrom("published")).toEqual(["archived"]);
  });

  it("returns an empty array for the terminal archived status", () => {
    expect(pageAdvanceableStatusesFrom("archived")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(pageAdvanceableStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("matches the table's own keys", () => {
    expect(Object.keys(PAGE_LIFECYCLE_TRANSITIONS)).toEqual(["draft", "published", "archived"]);
  });
});

describe("templateCanArchive", () => {
  it("allows archiving an active template", () => {
    expect(templateCanArchive("active")).toBe(true);
  });

  it("does not allow archiving an already-archived template", () => {
    expect(templateCanArchive("archived")).toBe(false);
  });
});
