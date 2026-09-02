import { describe, expect, it } from "vitest";
import {
  advanceableReviewStatusesFrom,
  canFlagFrom,
  canRejectFrom,
  canRemoveFrom,
  canRestoreFrom,
  REVIEW_LIFECYCLE_TRANSITIONS,
} from "./review-lifecycle";

describe("canRejectFrom", () => {
  it("is true only at pending", () => {
    expect(canRejectFrom("pending")).toBe(true);
  });

  it("is false everywhere else", () => {
    expect(canRejectFrom("published")).toBe(false);
    expect(canRejectFrom("flagged")).toBe(false);
    expect(canRejectFrom("rejected")).toBe(false);
    expect(canRejectFrom("removed")).toBe(false);
  });
});

describe("canFlagFrom", () => {
  it("is true only at published", () => {
    expect(canFlagFrom("published")).toBe(true);
  });

  it("is false everywhere else, including pending", () => {
    expect(canFlagFrom("pending")).toBe(false);
    expect(canFlagFrom("flagged")).toBe(false);
    expect(canFlagFrom("rejected")).toBe(false);
    expect(canFlagFrom("removed")).toBe(false);
  });
});

describe("canRestoreFrom", () => {
  it("is true only at flagged", () => {
    expect(canRestoreFrom("flagged")).toBe(true);
  });

  it("is false everywhere else", () => {
    expect(canRestoreFrom("pending")).toBe(false);
    expect(canRestoreFrom("published")).toBe(false);
    expect(canRestoreFrom("rejected")).toBe(false);
    expect(canRestoreFrom("removed")).toBe(false);
  });
});

describe("canRemoveFrom", () => {
  it("is true at published and flagged", () => {
    expect(canRemoveFrom("published")).toBe(true);
    expect(canRemoveFrom("flagged")).toBe(true);
  });

  it("is false everywhere else", () => {
    expect(canRemoveFrom("pending")).toBe(false);
    expect(canRemoveFrom("rejected")).toBe(false);
    expect(canRemoveFrom("removed")).toBe(false);
  });
});

describe("advanceableReviewStatusesFrom", () => {
  it("offers published at pending — the one transition no dedicated moderate action covers", () => {
    expect(advanceableReviewStatusesFrom("pending")).toEqual(["published"]);
  });

  it("is empty at published — fully covered by the dedicated flag/remove actions", () => {
    expect(advanceableReviewStatusesFrom("published")).toEqual([]);
  });

  it("is empty at flagged — fully covered by the dedicated restore/remove actions", () => {
    expect(advanceableReviewStatusesFrom("flagged")).toEqual([]);
  });

  it("returns an empty array for the terminal statuses", () => {
    expect(advanceableReviewStatusesFrom("rejected")).toEqual([]);
    expect(advanceableReviewStatusesFrom("removed")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(advanceableReviewStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("every status in the hand-kept table has an entry (no key silently missing)", () => {
    for (const status of Object.keys(REVIEW_LIFECYCLE_TRANSITIONS)) {
      expect(() => advanceableReviewStatusesFrom(status)).not.toThrow();
    }
  });
});
