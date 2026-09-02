import { describe, expect, it } from "vitest";
import { advanceableFlagStatusesFrom, FLAG_LIFECYCLE_TRANSITIONS } from "./feature-flag-lifecycle";

describe("advanceableFlagStatusesFrom", () => {
  it("offers killed and archived from active", () => {
    expect(advanceableFlagStatusesFrom("active")).toEqual(["killed", "archived"]);
  });

  it("offers active and archived from killed — a killed flag can be revived", () => {
    expect(advanceableFlagStatusesFrom("killed")).toEqual(["active", "archived"]);
  });

  it("returns an empty array for the terminal archived status", () => {
    expect(advanceableFlagStatusesFrom("archived")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(advanceableFlagStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("every status in the hand-kept table has an entry (no key silently missing)", () => {
    for (const status of Object.keys(FLAG_LIFECYCLE_TRANSITIONS)) {
      expect(() => advanceableFlagStatusesFrom(status)).not.toThrow();
    }
  });
});
