import { describe, expect, it } from "vitest";
import {
  PROMOTION_LIFECYCLE_TRANSITIONS,
  promotionAdvanceableStatusesFrom,
} from "./promotion-lifecycle";

describe("promotionAdvanceableStatusesFrom", () => {
  it("returns every allowed target from draft", () => {
    expect(promotionAdvanceableStatusesFrom("draft")).toEqual([
      "scheduled",
      "active",
      "cancelled",
      "archived",
    ]);
  });

  it("returns every allowed target from scheduled", () => {
    expect(promotionAdvanceableStatusesFrom("scheduled")).toEqual([
      "active",
      "cancelled",
      "archived",
    ]);
  });

  it("returns every allowed target from active", () => {
    expect(promotionAdvanceableStatusesFrom("active")).toEqual([
      "paused",
      "expired",
      "depleted",
      "cancelled",
      "archived",
    ]);
  });

  it("returns every allowed target from paused", () => {
    expect(promotionAdvanceableStatusesFrom("paused")).toEqual([
      "active",
      "expired",
      "cancelled",
      "archived",
    ]);
  });

  it("returns only archived from expired", () => {
    expect(promotionAdvanceableStatusesFrom("expired")).toEqual(["archived"]);
  });

  it("returns only archived from depleted", () => {
    expect(promotionAdvanceableStatusesFrom("depleted")).toEqual(["archived"]);
  });

  it("returns only archived from cancelled", () => {
    expect(promotionAdvanceableStatusesFrom("cancelled")).toEqual(["archived"]);
  });

  it("returns an empty array for the terminal archived status", () => {
    expect(promotionAdvanceableStatusesFrom("archived")).toEqual([]);
  });

  it("returns an empty array for an unrecognized status rather than throwing", () => {
    expect(promotionAdvanceableStatusesFrom("not-a-real-status")).toEqual([]);
  });

  it("matches the table's own keys", () => {
    expect(Object.keys(PROMOTION_LIFECYCLE_TRANSITIONS)).toEqual([
      "draft",
      "scheduled",
      "active",
      "paused",
      "expired",
      "depleted",
      "cancelled",
      "archived",
    ]);
  });
});
