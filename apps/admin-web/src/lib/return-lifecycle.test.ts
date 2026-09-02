import { describe, expect, it } from "vitest";
import {
  advanceableReturnStatusesFrom,
  hasDedicatedActionFrom,
  RETURN_LIFECYCLE_TRANSITIONS,
} from "./return-lifecycle";

describe("hasDedicatedActionFrom", () => {
  it("is true for every status with a dedicated write route", () => {
    expect(hasDedicatedActionFrom("requested")).toBe(true);
    expect(hasDedicatedActionFrom("approved")).toBe(true);
    expect(hasDedicatedActionFrom("rma_generated")).toBe(true);
    expect(hasDedicatedActionFrom("package_received")).toBe(true);
    expect(hasDedicatedActionFrom("inspection_completed")).toBe(true);
    expect(hasDedicatedActionFrom("items_accepted")).toBe(true);
  });

  it("is false for the statuses that only close via the generic advance route", () => {
    expect(hasDedicatedActionFrom("rejected")).toBe(false);
    expect(hasDedicatedActionFrom("items_rejected")).toBe(false);
    expect(hasDedicatedActionFrom("refund_requested")).toBe(false);
    expect(hasDedicatedActionFrom("replacement_requested")).toBe(false);
    expect(hasDedicatedActionFrom("repair_requested")).toBe(false);
  });

  it("is false for the terminal status", () => {
    expect(hasDedicatedActionFrom("closed")).toBe(false);
  });
});

describe("advanceableReturnStatusesFrom", () => {
  it("offers exactly closed for every status with no dedicated action", () => {
    expect(advanceableReturnStatusesFrom("rejected")).toEqual(["closed"]);
    expect(advanceableReturnStatusesFrom("items_rejected")).toEqual(["closed"]);
    expect(advanceableReturnStatusesFrom("refund_requested")).toEqual(["closed"]);
    expect(advanceableReturnStatusesFrom("replacement_requested")).toEqual(["closed"]);
    expect(advanceableReturnStatusesFrom("repair_requested")).toEqual(["closed"]);
  });

  it("returns an empty array for the terminal status", () => {
    expect(advanceableReturnStatusesFrom("closed")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(advanceableReturnStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("matches the full hand-kept transition table's shape (every status has an entry)", () => {
    for (const status of Object.keys(RETURN_LIFECYCLE_TRANSITIONS)) {
      expect(advanceableReturnStatusesFrom(status)).toEqual(RETURN_LIFECYCLE_TRANSITIONS[status]);
    }
  });
});
